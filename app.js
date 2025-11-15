/* =============================
   GLOBAL STATE
   ============================= */
let playerRoster = [];
let matchHistory = [];
let currentMatch = null;
let gameMode = "doubles";
let gameStyle = "customised";
let waitingQueue = [];
let tournamentBracket = []; 
let tournamentTeams = [];
let previousState = null; // For Undo

/* =============================
   INPUTS & DOM
   ============================= */
const inputs = {
    name: document.getElementById("playerName"),
    skill: document.getElementById("playerSkill"),
    scoreA: document.getElementById("scoreA"),
    scoreB: document.getElementById("scoreB")
};
const undoBtn = document.getElementById("undoBtn");
const gameSection = document.getElementById("gameSection");
const setupSection = document.getElementById("setupSection");

/* =============================
   NEW: SESSION PERSISTENCE
   ============================= */
function saveSession() {
    const sessionData = {
        playerRoster, matchHistory, currentMatch, gameMode, gameStyle,
        waitingQueue, tournamentBracket, tournamentTeams, previousState,
        isGameInProgress: !gameSection.classList.contains("hidden")
    };
    localStorage.setItem('badmintonSession', JSON.stringify(sessionData));
}

function loadSession() {
    const savedData = localStorage.getItem('badmintonSession');
    if (!savedData) return;

    try {
        const sessionData = JSON.parse(savedData);
        
        playerRoster = sessionData.playerRoster || [];
        matchHistory = sessionData.matchHistory || [];
        currentMatch = sessionData.currentMatch || null;
        gameMode = sessionData.gameMode || "doubles";
        gameStyle = sessionData.gameStyle || "customised";
        waitingQueue = sessionData.waitingQueue || [];
        tournamentBracket = sessionData.tournamentBracket || [];
        tournamentTeams = sessionData.tournamentTeams || [];
        previousState = sessionData.previousState || null; // Restore undo state

        if (sessionData.isGameInProgress) {
            setupSection.classList.add("hidden");
            gameSection.classList.remove("hidden");
            
            if (gameStyle === "tournament") {
                document.getElementById("queueSection").classList.add("hidden");
                document.getElementById("tournamentBracketView").classList.remove("hidden");
                updateBracketUI();
            } else {
                document.getElementById("queueSection").classList.remove("hidden");
                document.getElementById("tournamentBracketView").classList.add("hidden");
                updateQueueUI();
            }
            updateGameUI();
        }

        // Enable undo button if there's a state to restore
        if (previousState) {
            undoBtn.disabled = false;
            undoBtn.innerText = "Undo Last Match";
        }
        
        updateSetupUI(); // This calls updateLeaderboard
        updateHistoryUI();
        updateMatrices();

    } catch (e) {
        console.error("Error loading session:", e);
        localStorage.removeItem('badmintonSession');
    }
}

/* =============================
   PLAYER MANAGEMENT
   ============================= */
document.getElementById("addPlayerBtn").addEventListener("click", () => {
    const name = inputs.name.value.trim();
    if (!name) return;
    
    const newPlayer = {
        id: Date.now() + Math.random(),
        name: name,
        skill: parseInt(inputs.skill.value),
        totalWins: 0, totalMatchesPlayed: 0, consecutiveWins: 0,
        partnerHistory: {}, opponentHistory: {},
        partnerWins: {}, opponentWins: {} // NEW: For advanced stats
    };
    
    playerRoster.push(newPlayer);
    
    // NEW: Add player mid-game
    if (!gameSection.classList.contains("hidden") && gameStyle !== "tournament") {
        waitingQueue.push(newPlayer); // Add to back of queue
        updateQueueUI();
        alert(`${name} was added to the back of the queue!`);
    }
    
    inputs.name.value = "";
    updateSetupUI();
    saveSession();
});

// NEW: Remove player mid-game
window.removePlayer = function(id) {
    if (confirm("Are you sure you want to remove this player?")) {
        playerRoster = playerRoster.filter(p => p.id !== id);
        
        // Also remove from queue if game is running
        if (!gameSection.classList.contains("hidden")) {
            waitingQueue = waitingQueue.filter(p => p.id !== id);
            updateQueueUI();
        }
        
        updateSetupUI();
        updateMatrices(); // Roster has changed
        saveSession();
    }
};

function updateSetupUI() {
    const list = document.getElementById("rosterList");
    list.innerHTML = "";
    playerRoster.forEach(p => {
        list.innerHTML += `<li><span>${p.name} (${"⭐".repeat(p.skill)})</span> <button class="delete-btn" onclick="removePlayer(${p.id})">✕</button></li>`;
    });
    updateLeaderboard();
}

/* =============================
   GAME INITIALIZATION
   ============================= */
document.getElementById("startGameBtn").addEventListener("click", () => {
    gameMode = document.getElementById("gameMode").value;
    gameStyle = document.getElementById("gameStyle").value;

    const min = gameMode === "doubles" ? 4 : 2;
    if (playerRoster.length < min) { alert(`Need at least ${min} players!`); return; }

    setupSection.classList.add("hidden");
    gameSection.classList.remove("hidden");
    
    undoBtn.disabled = true;
    undoBtn.innerText = "Undo Last Match (Disabled)";
    previousState = null;

    if (gameStyle === "tournament") {
        setupTournament();
    } else {
        setupFairPlay();
    }
    saveSession();
});

/* =============================
   MODE 1: FAIR PLAY ENGINE
   ============================= */
function setupFairPlay() {
    document.getElementById("queueSection").classList.remove("hidden");
    document.getElementById("tournamentBracketView").classList.add("hidden");
    
    waitingQueue = [...playerRoster];
    shuffleArray(waitingQueue);
    createNextFairPlayMatch(null);
}

function createNextFairPlayMatch(incumbents) {
    inputs.scoreA.value = ""; inputs.scoreB.value = "";
    
    let pool = [];
    if(incumbents) pool = [...incumbents];
    
    if (waitingQueue.length >= 6) {
        const topSlice = waitingQueue.slice(0, 6);
        const rest = waitingQueue.slice(6);
        shuffleArray(topSlice);
        waitingQueue = [...topSlice, ...rest];
    }

    let needed = (gameMode === "doubles" ? 4 : 2) - pool.length;
    while (needed > 0 && waitingQueue.length > 0) {
        let p = waitingQueue.shift();
        p.status = "playing";
        pool.push(p);
        needed--;
    }

    if (gameMode === "doubles" && pool.length === 4) {
        currentMatch = balanceDoublesTeamsWithDiversity(pool);
    } else if (gameMode === "singles" && pool.length === 2) {
        currentMatch = { type: 'fairplay', teamA: [pool[0]], teamB: [pool[1]] };
    } else {
        alert("Not enough players left in queue!");
        currentMatch = null;
        return;
    }
    
    updateGameUI();
    updateQueueUI();
}

function handleFairPlayWin(side) {
    const winners = side === "A" ? currentMatch.teamA : currentMatch.teamB;
    const losers = side === "A" ? currentMatch.teamB : currentMatch.teamA;

    losers.forEach(p => { p.status = "waiting"; waitingQueue.push(p); });

    let nextIncumbents = winners;
    // Ensure consecutiveWins is a number
    winners.forEach(p => p.consecutiveWins = (p.consecutiveWins || 0));
    
    if (winners[0].consecutiveWins >= 2) {
        winners.forEach(p => { p.consecutiveWins = 0; p.status = "waiting"; waitingQueue.push(p); });
        nextIncumbents = null;
    }
    
    createNextFairPlayMatch(nextIncumbents);
}

/* =============================
   MODE 2: TOURNAMENT ENGINE
   ============================= */
// ... (Your existing setupTournament, startNextTournamentMatch, handleTournamentWin functions go here - they are unchanged)
function setupTournament() {
    document.getElementById("queueSection").classList.add("hidden");
    document.getElementById("tournamentBracketView").classList.remove("hidden");

    tournamentTeams = [];
    let participants = [...playerRoster];
    shuffleArray(participants);

    if (gameMode === "singles") {
        tournamentTeams = participants.map(p => ({ id: p.id, name: p.name, players: [p] }));
    } else {
        while (participants.length >= 2) {
            const p1 = participants.shift();
            const p2 = participants.shift();
            tournamentTeams.push({ id: p1.id + p2.id, name: `${p1.name} & ${p2.name}`, players: [p1, p2] });
        }
        if (participants.length > 0) alert(`${participants[0].name} sitting out (odd number).`);
    }

    let size = 1;
    while (size < tournamentTeams.length) size *= 2;
    let bracketSlots = [...tournamentTeams];
    while (bracketSlots.length < size) bracketSlots.push({ name: "BYE", isBye: true, players: [] });

    tournamentBracket = [];
    let round1 = [];
    for (let i = 0; i < size; i += 2) {
        let match = { id: `r1-m${i/2}`, round: 0, teamA: bracketSlots[i], teamB: bracketSlots[i+1], winner: null, score: null };
        if (match.teamB.isBye) match.winner = match.teamA;
        else if (match.teamA.isBye) match.winner = match.teamB;
        round1.push(match);
    }
    tournamentBracket.push(round1);

    let currentSize = size / 2;
    let rIdx = 1;
    while (currentSize > 1) {
        let nextRound = [];
        for (let i = 0; i < currentSize; i += 2) {
            nextRound.push({ id: `r${rIdx}-m${i/2}`, round: rIdx, teamA: null, teamB: null, winner: null, score: null });
        }
        tournamentBracket.push(nextRound);
        currentSize /= 2;
        rIdx++;
    }

    updateBracketUI();
    startNextTournamentMatch();
}

function startNextTournamentMatch() {
    inputs.scoreA.value = ""; inputs.scoreB.value = "";
    
    let readyMatch = null;
    for (let r = 0; r < tournamentBracket.length; r++) {
        for (let m of tournamentBracket[r]) {
            if (!m.winner && m.teamA && m.teamB) {
                readyMatch = m;
                break;
            }
        }
        if (readyMatch) break;
    }

    if (readyMatch) {
        currentMatch = { 
            type: 'tournament', data: readyMatch, 
            teamA: readyMatch.teamA.players, teamB: readyMatch.teamB.players 
        };
        updateGameUI();
    } else {
        let final = tournamentBracket[tournamentBracket.length-1][0];
        if (final.winner) {
            alert(`🏆 WINNER: ${final.winner.name}`);
            document.getElementById("gameSection").innerHTML = `<div style="text-align:center;padding:50px" class="card"><h1>🏆 ${final.winner.name} Wins!</h1><button onclick="location.reload()" class="primary-btn">Reset</button></div>`;
        }
    }
}

function handleTournamentWin(side, sA, sB) {
    let match = currentMatch.data;
    let winner = side === "A" ? match.teamA : match.teamB;
    match.winner = winner;
    match.score = `${sA}-${sB}`;

    let nextR = match.round + 1;
    if (nextR < tournamentBracket.length) {
        let currIdx = tournamentBracket[match.round].indexOf(match);
        let nextIdx = Math.floor(currIdx / 2);
        let slot = currIdx % 2 === 0 ? 'teamA' : 'teamB';
        tournamentBracket[nextR][nextIdx][slot] = winner;
    }

    updateBracketUI();
    startNextTournamentMatch();
}


/* =============================
   NEW: UNDO HELPER
   ============================= */
function saveStateForUndo() {
    // Create deep copies of all critical data
    previousState = {
        playerRoster: JSON.parse(JSON.stringify(playerRoster)),
        matchHistory: JSON.parse(JSON.stringify(matchHistory)),
        currentMatch: JSON.parse(JSON.stringify(currentMatch)),
        waitingQueue: JSON.parse(JSON.stringify(waitingQueue)),
        tournamentBracket: JSON.parse(JSON.stringify(tournamentBracket))
    };
}

/* =============================
   SHARED MATCH END LOGIC
   ============================= */
document.getElementById("recordMatchBtn").addEventListener("click", () => {
    if (!currentMatch) { alert("No match is in progress!"); return; }

    const sA = parseInt(inputs.scoreA.value);
    const sB = parseInt(inputs.scoreB.value);
    
    if (isNaN(sA) || isNaN(sB)) { alert("Please enter valid scores."); return; }
    if (sA === sB) { alert("No draws allowed!"); return; }
    
    // --- SAVE SNAPSHOT FOR UNDO ---
    saveStateForUndo();

    const side = sA > sB ? "A" : "B";
    const winners = side === "A" ? currentMatch.teamA : currentMatch.teamB;
    const losers = side === "A" ? currentMatch.teamB : currentMatch.teamA;
    
    // 1. Stats
    winners.forEach(p => { 
        if (!p) return; // Safety check for empty teams
        p.totalWins++; 
        p.totalMatchesPlayed++; 
        p.consecutiveWins = (p.consecutiveWins || 0) + 1;
    });
    losers.forEach(p => { 
        if (!p) return;
        p.totalMatchesPlayed++; 
        p.consecutiveWins = 0; 
    });
    
    // 2. History Tracking
    updateDiversityHistory(winners, losers, side);

    // 3. Log to History
    let tANames = currentMatch.teamA.map(p=>p.name).join(" & ");
    let tBNames = currentMatch.teamB.map(p=>p.name).join(" & ");
    if(currentMatch.type === 'tournament' && !currentMatch.teamA.length) {
        tANames = currentMatch.data.teamA.name; tBNames = currentMatch.data.teamB.name;
    }

    matchHistory.unshift({ winner: side, sA, sB, tA: tANames, tB: tBNames });
    
    // 4. Update UI
    updateLeaderboard();
    updateHistoryUI();
    updateMatrices();
    
    // 5. Enable Undo button
    undoBtn.disabled = false;
    undoBtn.innerText = "Undo Last Match";

    // 6. Save and move to next match
    saveSession();
    
    if (gameStyle === "tournament") handleTournamentWin(side, sA, sB);
    else handleFairPlayWin(side);
});

/* =============================
   DATA HELPERS
   ============================= */
function balanceDoublesTeamsWithDiversity(pool) {
    const wPartner = parseInt(document.getElementById('weightPartner').value) || 20;
    const wOpponent = parseInt(document.getElementById('weightOpponent').value) || 5;
    const wSkill = parseInt(document.getElementById('weightSkill').value) || 8;

    const combos = [
        { a:[0,1], b:[2,3] }, { a:[0,2], b:[1,3] }, { a:[0,3], b:[1,2] }
    ];
    combos.sort(() => Math.random() - 0.5);

    let best = null;
    let bestScore = -Infinity;

    for (const c of combos) {
        const A1 = pool[c.a[0]], A2 = pool[c.a[1]];
        const B1 = pool[c.b[0]], B2 = pool[c.b[1]];

        const repA = (A1.partnerHistory[A2.id] || 0);
        const repB = (B1.partnerHistory[B2.id] || 0);
        const partnerPenalty = (repA**2 + repB**2) * wPartner; 

        const opp = (A1.opponentHistory[B1.id] || 0) + (A1.opponentHistory[B2.id] || 0) +
                    (A2.opponentHistory[B1.id] || 0) + (A2.opponentHistory[B2.id] || 0);
        const opponentPenalty = opp * wOpponent;

        const skillDiff = Math.abs((A1.skill + A2.skill) - (B1.skill + B2.skill));
        const skillPenalty = skillDiff * wSkill;

        const totalScore = 500 - partnerPenalty - opponentPenalty - skillPenalty;      

        if (totalScore > bestScore) {
            bestScore = totalScore;
            best = { type: 'fairplay', teamA: [A1, A2], teamB: [B1, B2] };
        }
    }
    return best;
}

// NEW: Advanced History Tracking
function updateDiversityHistory(winners, losers, winnerSide) {
    if (gameMode === "doubles") {
        if (!winners[0] || !winners[1] || !losers[0] || !losers[1]) return; // Safety
        
        // Update Partner Stats
        updatePairStats(winners[0], winners[1], 'partnerHistory', true);
        updatePairStats(losers[0], losers[1], 'partnerHistory', false);
        
        // Update Opponent Stats
        updatePairStats(winners[0], losers[0], 'opponentHistory', true);
        updatePairStats(winners[0], losers[1], 'opponentHistory', true);
        updatePairStats(winners[1], losers[0], 'opponentHistory', true);
        updatePairStats(winners[1], losers[1], 'opponentHistory', true);

    } else {
        if (!winners[0] || !losers[0]) return; // Safety
        updatePairStats(winners[0], losers[0], 'opponentHistory', true);
    }
}

function updatePairStats(p1, p2, type, didP1Win) {
    if (!p1 || !p2) return; // Safety for singles
    
    // Init objects if they don't exist
    if (!p1[type]) p1[type] = {}; if (!p2[type]) p2[type] = {};
    if (!p1.partnerWins) p1.partnerWins = {}; if (!p2.partnerWins) p2.partnerWins = {};
    if (!p1.opponentWins) p1.opponentWins = {}; if (!p2.opponentWins) p2.opponentWins = {};

    // Increment history count
    p1[type][p2.id] = (p1[type][p2.id] || 0) + 1;
    p2[type][p1.id] = (p2[type][p1.id] || 0) + 1;

    // Increment win counts
    if (type === 'partnerHistory') {
        if (didP1Win) {
            p1.partnerWins[p2.id] = (p1.partnerWins[p2.id] || 0) + 1;
            p2.partnerWins[p1.id] = (p2.partnerWins[p1.id] || 0) + 1;
        }
    } else { // opponentHistory
        if (didP1Win) {
            p1.opponentWins[p2.id] = (p1.opponentWins[p2.id] || 0) + 1;
        } else {
            p2.opponentWins[p1.id] = (p2.opponentWins[p1.id] || 0) + 1;
        }
    }
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

/* =============================
   UI UPDATES (TABS & MATRICES)
   ============================= */
window.switchTab = function(name) {
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(name+"-tab").classList.add("active");
    
    const map = { 'leaderboard': 0, 'player-stats': 1, 'history': 2, 'partners': 3, 'opponents': 4, 'summary': 5 };
    const btns = document.querySelectorAll(".tab-btn");
    btns.forEach(b => b.classList.remove("active"));
    
    // Find the button by its onclick attribute
    const clickedBtn = Array.from(btns).find(btn => btn.getAttribute("onclick") === `switchTab('${name}')`);
    if (clickedBtn) clickedBtn.classList.add("active");

    if (name === 'partners' || name === 'opponents' || name === 'summary' || name === 'player-stats') {
        updateMatrices();
    }
}

function updateMatrices() {
    updateLeaderboard(); // Leaderboard contains Win%
    updatePlayerStatsUI(); // New stats tab
    updatePartnershipMatrix();
    updateOpponentMatrix();
    updateStatsSummary();
}

// NEW: Calculate and display Best Partner / Nemesis
function updatePlayerStatsUI() {
    const body = document.getElementById("playerStatsBody");
    body.innerHTML = "";
    
    for (const player of playerRoster) {
        let bestPartner = { name: "N/A", rate: -1 };
        let nemesis = { name: "N/A", rate: 101 };

        // Calculate Best Partner
        for (const partnerId in player.partnerHistory) {
            const partner = playerRoster.find(p => p.id == partnerId);
            if (!partner) continue;
            
            const totalGames = player.partnerHistory[partnerId];
            const wins = player.partnerWins[partnerId] || 0;
            const winRate = (wins / totalGames) * 100;
            
            if (winRate > bestPartner.rate) {
                bestPartner = { name: partner.name, rate: winRate };
            }
        }

        // Calculate Nemesis
        for (const oppId in player.opponentHistory) {
            const opponent = playerRoster.find(p => p.id == oppId);
            if (!opponent) continue;
            
            const totalGames = player.opponentHistory[oppId];
            const wins = player.opponentWins[oppId] || 0;
            const winRate = (wins / totalGames) * 100;

            if (winRate < nemesis.rate) {
                nemesis = { name: opponent.name, rate: winRate };
            }
        }
        
        // Format for display
        const bpDisplay = bestPartner.name === 'N/A' ? `<span class="stat-neutral">N/A</span>` : `<span class="stat-good">${bestPartner.name}</span> (${bestPartner.rate.toFixed(0)}%)`;
        const nDisplay = nemesis.name === 'N/A' ? `<span class="stat-neutral">N/A</span>` : `<span class="stat-bad">${nemesis.name}</span> (${nemesis.rate.toFixed(0)}%)`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${player.name}</td>
            <td>${bpDisplay}</td>
            <td>${nDisplay}</td>
        `;
        body.appendChild(tr);
    }
}


function updatePartnershipMatrix() {
    const c = document.getElementById("partnershipMatrix");
    if(!playerRoster.length) return c.innerHTML = "<p style='text-align:center;color:#999'>No players</p>";
    let html = '<table class="stats-table"><tr><th></th>';
    playerRoster.forEach(p => html += `<th>${p.name.substring(0,3)}</th>`);
    html += "</tr>";
    playerRoster.forEach(r => {
        html += `<tr><th>${r.name.substring(0,3)}</th>`;
        playerRoster.forEach(col => {
            if(r.id === col.id) html += '<td style="background:#eee">-</td>';
            else {
                let val = r.partnerHistory[col.id] || 0;
                html += `<td class="heat-${Math.min(val,9)}">${val}</td>`;
            }
        });
        html += "</tr>";
    });
    c.innerHTML = html + "</table>";
}

function updateOpponentMatrix() {
    const c = document.getElementById("opponentMatrix");
    if(!playerRoster.length) return c.innerHTML = "<p style='text-align:center;color:#999'>No players</p>";
    let html = '<table class="stats-table"><tr><th></th>';
    playerRoster.forEach(p => html += `<th>${p.name.substring(0,3)}</th>`);
    html += "</tr>";
    playerRoster.forEach(r => {
        html += `<tr><th>${r.name.substring(0,3)}</th>`;
        playerRoster.forEach(col => {
            if(r.id === col.id) html += '<td style="background:#eee">-</td>';
            else {
                let val = r.opponentHistory[col.id] || 0;
                html += `<td class="heat-${Math.min(val,9)}">${val}</td>`;
            }
        });
        html += "</tr>";
    });
    c.innerHTML = html + "</table>";
}

function updateStatsSummary() {
    const c = document.getElementById("statsSummary");
    if(!playerRoster.length) return;
    
    const matches = playerRoster.map(p => p.totalMatchesPlayed);
    const variance = matches.length ? Math.max(...matches) - Math.min(...matches) : 0;
    const avg = matches.length ? (matches.reduce((a,b)=>a+b,0)/matches.length).toFixed(1) : 0;

    c.innerHTML = `
        <div class="stat-box"><div class="stat-value">${variance}</div><div class="stat-label">Variance</div></div>
        <div class="stat-box"><div class="stat-value">${avg}</div><div class="stat-label">Avg Matches</div></div>
    `;
}

/* =============================
   UI UPDATES (GAME)
   ============================= */
function updateGameUI() {
    if (!currentMatch) {
        document.getElementById("teamA-area").textContent = "N/A";
        document.getElementById("teamB-area").textContent = "N/A";
        return;
    }
    let tA = currentMatch.teamA.map(p => p.name).join(" & ");
    let tB = currentMatch.teamB.map(p => p.name).join(" & ");
    if(currentMatch.type === 'tournament' && !currentMatch.teamA.length) {
        tA = currentMatch.data.teamA.name; tB = currentMatch.data.teamB.name;
    }
    document.getElementById("teamA-area").textContent = tA || "Waiting...";
    document.getElementById("teamB-area").textContent = tB || "Waiting...";
}

function updateQueueUI() {
    document.getElementById("waitingQueueDisplay").textContent = 
        waitingQueue.length ? waitingQueue.map(p=>p.name).join(", ") : "Empty";
}

// UPDATED: Now includes Win %
function updateLeaderboard() {
    const tb = document.getElementById("leaderboardBody"); // Corrected ID
    if (!tb) return; // Safety check
    tb.innerHTML = "";
    
    [...playerRoster].sort((a,b)=>b.totalWins-a.totalWins).forEach(p => {
        const winRate = (p.totalMatchesPlayed > 0) ? ((p.totalWins / p.totalMatchesPlayed) * 100).toFixed(0) : 0;
        
        tb.innerHTML += `
            <tr>
                <td>${p.name}</td>
                <td>${p.totalWins}</td>
                <td>${p.totalMatchesPlayed}</td>
                <td>${winRate}%</td>
            </tr>`;
    });
}

function updateHistoryUI() {
    const list = document.getElementById("matchHistoryList");
    list.innerHTML = "";
    if (matchHistory.length === 0) {
        list.innerHTML = '<p style="color:#999;text-align:center">No matches yet</p>';
        return;
    }
    matchHistory.forEach(m => {
        list.innerHTML += `<div class="history-item">
            <span class="${m.winner==='A'?'winner-text':''}">${m.tA}</span>
            <span class="history-score">${m.sA} - ${m.sB}</span>
            <span class="${m.winner==='B'?'winner-text':''}">${m.tB}</span>
        </div>`;
    });
}

function updateBracketUI() {
    const c = document.getElementById("bracketContainer");
    c.innerHTML = "";
    tournamentBracket.forEach((round, i) => {
        let html = `<div class="bracket-round"><div class="bracket-title">Round ${i+1}</div>`;
        round.forEach(m => {
            let cls = m.winner ? "completed" : (m.teamA && m.teamB ? "active" : "");
            let nA = m.teamA ? m.teamA.name : "?";
            let nB = m.teamB ? m.teamB.name : "?";
            if(m.winner === m.teamA) nA = `<b>${nA} ✅</b>`;
            if(m.winner === m.teamB) nB = `<b>${nB} ✅</b>`;
            html += `<div class="bracket-match ${cls}">${nA}<br><small>vs</small><br>${nB}</div>`;
        });
        c.innerHTML += html + "</div>";
    });
}

/* =============================
   NEW: UNDO ACTION
   ============================= */
undoBtn.addEventListener("click", () => {
    if (!previousState) {
        alert("No match recorded yet to undo.");
        return;
    }
    
    // Restore all the data from the snapshot
    playerRoster = previousState.playerRoster;
    matchHistory = previousState.matchHistory;
    currentMatch = previousState.currentMatch;
    waitingQueue = previousState.waitingQueue;
    tournamentBracket = previousState.tournamentBracket;
    
    // Redraw all UI elements
    updateSetupUI(); // This calls updateLeaderboard
    updateHistoryUI();
    updateMatrices();
    updateGameUI();
    updateQueueUI();
    updateBracketUI();
    
    // Disable the button (one-time use)
    undoBtn.disabled = true;
    undoBtn.innerText = "Undo Last Match (Disabled)";
    
    // Clear the state
    previousState = null;
    
    // Save the *reverted* state to local storage
    saveSession();
});

// End Session
document.getElementById("endGameBtn").addEventListener("click", () => {
    if (confirm("End Session?")) {
        document.getElementById("gameSection").classList.add("hidden");
        document.getElementById("setupSection").classList.remove("hidden");
        
        localStorage.removeItem('badmintonSession');

        // Reset game data
        matchHistory = []; waitingQueue = []; tournamentBracket = [];
        playerRoster.forEach(p => {
            p.totalWins=0; p.totalMatchesPlayed=0; p.consecutiveWins=0;
            p.partnerHistory={}; p.opponentHistory={};
            p.partnerWins = {}; p.opponentWins = {}; // Clear new stats
        });
        
        // Disable undo and clear snapshot
        undoBtn.disabled = true;
        undoBtn.innerText = "Undo Last Match (Disabled)";
        previousState = null;
        
        updateSetupUI();
        updateHistoryUI();
        updateMatrices();
        document.getElementById("matchHistoryList").innerHTML = '<p style="color:#999;text-align:center">No matches yet</p>';
    }
});

// === LOAD SESSION ON STARTUP ===
window.addEventListener('load', loadSession);