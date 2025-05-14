const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const size = 600;
const center = size / 2;
const radii = [250, 160, 70]; // 外中内三圈半径 (调整以匹配图片)
const pointRadius = 14; // 棋子半径
let boardPoints = [];

// Game state variables - these will be primarily updated by server messages
let clientGameBoard = Array(24).fill(0);
let clientCurrentPlayer = 1; // Which player's turn is it
let clientPlacementPhase = true;
let clientPiecesPlaced = [0, 0];
let clientGameState = 'idle'; // idle, waiting_for_opponent, playing, awaiting_capture, ended

// Client-specific state
let ws = null;
let myPlayerId = null;       // 1 or 2, assigned by server
let currentRoomId = null;
let awaitingCapture = false; // Is this client selecting a piece to capture?
let capturablePieceIndices = []; // Array of indices this client can capture
let selectedPieceIndex = null; // For a two-step move: stores the index of the piece selected to be moved

// UI Elements
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomIdInput = document.getElementById('roomIdInput');
const currentRoomIdSpan = document.getElementById('currentRoomId');
const currentPlayerIdSpan = document.getElementById('currentPlayerId');
const turnIndicatorSpan = document.getElementById('turnIndicator');
const phaseIndicatorSpan = document.getElementById('phaseIndicator');
const statusMessageSpan = document.getElementById('statusMessage');
const gameCanvas = document.getElementById('board'); // 获取canvas元素的引用

function updateStatus(message, isError = false) {
    statusMessageSpan.textContent = message;
    statusMessageSpan.style.color = isError ? '#dc3545' : 
                                    (clientGameState === 'awaiting_capture' && myPlayerId === clientCurrentPlayer) ? '#ffc107' : 
                                    (selectedPieceIndex !== null) ? '#007bff' : // Blue for selection state
                                    '#28a745';
}

function updateGameInfoUI() {
    currentRoomIdSpan.textContent = currentRoomId || 'N/A';
    currentPlayerIdSpan.textContent = myPlayerId || 'N/A';
    turnIndicatorSpan.textContent = clientCurrentPlayer;
    let phaseText = clientPlacementPhase ? `放置阶段 (P1: ${clientPiecesPlaced[0]}/9, P2: ${clientPiecesPlaced[1]}/9)` : '走子阶段';
    if (clientGameState === 'awaiting_capture') {
        phaseText += ' - 等待吃子';
    } else if (selectedPieceIndex !== null) {
        phaseText += ` - 移动棋子 ${selectedPieceIndex}`;
    }
    phaseIndicatorSpan.textContent = phaseText;
}

// Calculate board points (same as before)
for (let r_idx = 0; r_idx < 3; r_idx++) {
    const radius = radii[r_idx];
    boardPoints.push({ x: center - radius, y: center - radius });
    boardPoints.push({ x: center, y: center - radius });
    boardPoints.push({ x: center + radius, y: center - radius });
    boardPoints.push({ x: center + radius, y: center });
    boardPoints.push({ x: center + radius, y: center + radius });
    boardPoints.push({ x: center, y: center + radius });
    boardPoints.push({ x: center - radius, y: center + radius });
    boardPoints.push({ x: center - radius, y: center });
}

function drawBoard() {
    ctx.clearRect(0, 0, size, size);
    const lineColor = "rgba(255, 255, 255, 0.7)";
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;

    // Draw squares and lines (existing code)
    for (let i = 0; i < 3; i++) {
        const r = radii[i];
        ctx.beginPath();
        ctx.rect(center - r, center - r, 2 * r, 2 * r);
        ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
        const outerCornerIdx = i * 2;
        const middleCornerIdx = 8 + i * 2;
        const innerCornerIdx = 16 + i * 2;
        ctx.beginPath();
        ctx.moveTo(boardPoints[outerCornerIdx].x, boardPoints[outerCornerIdx].y);
        ctx.lineTo(boardPoints[middleCornerIdx].x, boardPoints[middleCornerIdx].y);
        ctx.lineTo(boardPoints[innerCornerIdx].x, boardPoints[innerCornerIdx].y);
        ctx.stroke();
    }
    for (let i = 0; i < 4; i++) {
        const outerMidIdx = i * 2 + 1;
        const middleMidIdx = 8 + i * 2 + 1;
        const innerMidIdx = 16 + i * 2 + 1;
        ctx.beginPath();
        ctx.moveTo(boardPoints[outerMidIdx].x, boardPoints[outerMidIdx].y);
        ctx.lineTo(boardPoints[middleMidIdx].x, boardPoints[middleMidIdx].y);
        ctx.lineTo(boardPoints[innerMidIdx].x, boardPoints[innerMidIdx].y);
        ctx.stroke();
    }

    boardPoints.forEach((pt, idx) => {
        const pieceOwner = clientGameBoard[idx];
        let pieceBorderColor = null; // For selected piece

        if (selectedPieceIndex === idx && !awaitingCapture) {
            // Determine border color for selected piece
            if (pieceOwner === 1) {
                pieceBorderColor = '#932417'; // Darker Red for P1 selected
            } else if (pieceOwner === 2) {
                pieceBorderColor = '#105f92'; // Darker Blue for P2 selected
            }
        }

        if (pieceOwner === 1) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pointRadius, 0, 2 * Math.PI);
            ctx.fillStyle = "#e74c3c"; // Player 1 color (Red)
            ctx.fill();
            ctx.strokeStyle = pieceBorderColor || "#b71c1c"; // Default P1 border or selection border
            ctx.lineWidth = pieceBorderColor ? 3 : 1;
            ctx.stroke();
        } else if (pieceOwner === 2) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pointRadius, 0, 2 * Math.PI);
            ctx.fillStyle = "#3498db"; // Player 2 color (Blue)
            ctx.fill();
            ctx.strokeStyle = pieceBorderColor || "#1a237e"; // Default P2 border or selection border
            ctx.lineWidth = pieceBorderColor ? 3 : 1;
            ctx.stroke();
        } else {
            // Empty spot marker (small circle)
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pointRadius / 2, 0, 2 * Math.PI);
            ctx.fillStyle = "rgba(255, 255, 255, 0.3)"; // Semi-transparent white for empty
            ctx.fill();
            // Optionally, a very light border for empty spots, or none.
            // ctx.strokeStyle = "rgba(200, 200, 200, 0.5)";
            // ctx.lineWidth = 1;
            // ctx.stroke();
        }

        // Highlight capturable pieces if in that state
        if (awaitingCapture && capturablePieceIndices.includes(idx)) {
            ctx.strokeStyle = '#ffc107'; // Yellow highlight
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pointRadius + 3, 0, 2 * Math.PI); // Ring around the piece
            ctx.stroke();
        }
        
        // Reset line style for next board line/element after any special drawing
        ctx.strokeStyle = lineColor; 
        ctx.lineWidth = 2;
    });
    updateGameInfoUI();
}

function resetClientStateForNewGame() {
    currentRoomId = null;
    myPlayerId = null;
    clientGameBoard = Array(24).fill(0);
    clientCurrentPlayer = 1;
    clientPlacementPhase = true;
    clientPiecesPlaced = [0,0];
    clientGameState = 'idle';
    awaitingCapture = false;
    capturablePieceIndices = [];
    selectedPieceIndex = null; // Reset selected piece index
    gameCanvas.style.display = 'none';
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled = false;
    roomIdInput.disabled = false;
    roomIdInput.value = '';
    drawBoard();
}

function connectToServer() {
    // Adjust anker if using a different WebSocket URL
    const wsUrl = window.location.protocol === 'https:' ? 'wss://' : 'ws://' + window.location.hostname + ':3000';
    // const wsUrl = 'ws://localhost:3000'; // 直接使用localhost
    updateStatus('连接到服务器中...');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus('已连接到服务器!');
        createRoomBtn.disabled = false;
        joinRoomBtn.disabled = false;
        roomIdInput.disabled = false;
        clientGameState = 'connected';
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Message from server:', data);

        // Update core game state from ANY relevant message
        if (data.board) clientGameBoard = data.board;
        if (data.currentPlayer) clientCurrentPlayer = data.currentPlayer;
        if (data.placementPhase !== undefined) clientPlacementPhase = data.placementPhase;
        if (data.piecesPlaced) clientPiecesPlaced = data.piecesPlaced;
        if (data.gameState) {
            clientGameState = data.gameState;
            // If game state changes from awaiting_capture, reset selection
            if (clientGameState !== 'awaiting_capture') {
                selectedPieceIndex = null;
            }
        }

        // Reset capture state unless specifically told we are awaiting capture
        if (data.type !== 'line_formed_capture_pending') {
            awaitingCapture = false;
            capturablePieceIndices = [];
        } else { // if it IS line_formed_capture_pending, ensure selectedPieceIndex is cleared
            selectedPieceIndex = null;
        }

        switch (data.type) {
            case 'error':
                updateStatus(`错误: ${data.message}`, true);
                break;
            case 'room_created':
                myPlayerId = data.playerId;
                currentRoomId = data.roomId;
                updateStatus(`房间 ${currentRoomId} 已创建. 你是玩家 ${myPlayerId}. 等待对手加入...`);
                gameCanvas.style.display = 'none'; 
                drawBoard();
                createRoomBtn.disabled = true;
                joinRoomBtn.disabled = true;
                roomIdInput.disabled = true;
                break;
            case 'joined_room': // For the player who joined
                myPlayerId = data.playerId;
                currentRoomId = data.roomId;
                updateStatus(`已加入房间 ${currentRoomId}. 你是玩家 ${myPlayerId}. 等待游戏开始...`);
                gameCanvas.style.display = 'none';
                drawBoard(); 
                createRoomBtn.disabled = true;
                joinRoomBtn.disabled = true;
                roomIdInput.disabled = true;
                break;
            case 'opponent_joined': // For the player already in the room
            case 'game_start':
                updateStatus(`对手已加入! 游戏开始. 当前是玩家 ${clientCurrentPlayer} 的回合.`);
                gameCanvas.style.display = 'block'; // 显示棋盘
                drawBoard();
                break;
            case 'update':
                const lastMove = data.lastMove;
                let moveMsg = `玩家 ${lastMove.player} `;
                if (lastMove.action === 'place') {
                    moveMsg += `放置了棋子在 ${lastMove.index}.`;
                } else if (lastMove.action === 'move') {
                    moveMsg += `移动了棋子从 ${lastMove.from} 到 ${lastMove.to}.`;
                } else if (lastMove.action === 'capture') {
                    moveMsg += `吃掉了位于 ${lastMove.capturedIndex} 的棋子.`;
                }
                updateStatus(`${moveMsg} 当前是玩家 ${clientCurrentPlayer} 的回合.`);
                selectedPieceIndex = null; // Clear selection after any successful update from server
                drawBoard();
                break;
            case 'line_formed_capture_pending':
                awaitingCapture = true;
                capturablePieceIndices = data.capturablePieces || [];
                selectedPieceIndex = null; // Clear any piece selection when entering capture mode
                if (myPlayerId === clientCurrentPlayer) { 
                    updateStatus(`你已成龙! 请选择一个对方棋子吃掉. (可吃: ${capturablePieceIndices.join(', ')})`, false);
                } else {
                    // Should not happen if server logic is correct, but as a fallback.
                    updateStatus(`玩家 ${clientCurrentPlayer} 已成龙并正在选择吃子.`, false);
                }
                drawBoard(); // Redraw to highlight capturable pieces
                break;
            case 'opponent_awaiting_capture': // For the player whose opponent is capturing
                updateStatus(`对手已成龙，正在选择吃子...`, false);
                drawBoard(); // Redraw board (no highlights for this player)
                break;
            case 'opponent_disconnected':
                updateStatus('对手已断开连接. 游戏结束.', true);
                resetClientStateForNewGame();
                break;
            default:
                console.log('未知消息类型:', data.type);
        }
    };

    ws.onclose = () => {
        updateStatus('已从服务器断开.', true);
        resetClientStateForNewGame();
        createRoomBtn.disabled = true;
        joinRoomBtn.disabled = true;
        roomIdInput.disabled = true;
    };

    ws.onerror = (error) => {
        updateStatus('WebSocket 错误. 请检查服务器是否运行或刷新页面重试.', true);
        console.error('WebSocket Error:', error);
        resetClientStateForNewGame();
        createRoomBtn.disabled = true;
        joinRoomBtn.disabled = true;
        roomIdInput.disabled = true;
    };
}

createRoomBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'create_room' }));
        updateStatus('正在创建房间...');
    }
});

joinRoomBtn.addEventListener('click', () => {
    const roomIdToJoin = roomIdInput.value.trim().toUpperCase();
    if (!roomIdToJoin) {
        updateStatus('请输入有效的房间ID.', true);
        return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'join_room', roomId: roomIdToJoin }));
        updateStatus(`正在加入房间 ${roomIdToJoin}...`);
    }
});

canvas.addEventListener('click', function (e) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoomId || clientGameState === 'ended') {
        return; 
    }

    if (myPlayerId !== clientCurrentPlayer) {
        updateStatus('不是你的回合!', true);
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    for (let i = 0; i < boardPoints.length; i++) {
        const pt = boardPoints[i];
        const dx = mx - pt.x, dy = my - pt.y;
        if (dx * dx + dy * dy < pointRadius * pointRadius) { 
            if (awaitingCapture) {
                if (capturablePieceIndices.includes(i)) {
                    ws.send(JSON.stringify({ type: 'capture_piece', roomId: currentRoomId, index: i }));
                    updateStatus('正在吃子...');
                    awaitingCapture = false; 
                    capturablePieceIndices = [];
                    selectedPieceIndex = null; // Ensure selection is cleared
                } else {
                    updateStatus('请点击高亮的对方棋子进行吃子.', true);
                }
            } else if (clientPlacementPhase) {
                if (clientGameBoard[i] === 0) {
                    if (clientPiecesPlaced[myPlayerId-1] < 9) {
                        ws.send(JSON.stringify({ type: 'place_piece', roomId: currentRoomId, index: i }));
                        selectedPieceIndex = null; // Clear selection after action
                    } else {
                        updateStatus('你已放置所有9个棋子.', true);
                    }
                } else {
                    updateStatus('这个位置已经有棋子了.', true);
                }
            } else { // Moving phase (not awaiting capture, not placement phase)
                if (selectedPieceIndex === null) { // First click: selecting a piece to move
                    if (clientGameBoard[i] === myPlayerId) {
                        selectedPieceIndex = i;
                        updateStatus(`已选择你的棋子 ${i}. 请点击一个相邻的空位移动.`);
                        drawBoard();
                    } else if (clientGameBoard[i] === 0) {
                        updateStatus('请先选择你的一个棋子.', true);
                    } else { // Clicked opponent's piece
                        updateStatus('不能选择对方的棋子.', true);
                    }
                } else { // Second click: selecting a destination or deselecting/reselecting
                    const fromIndex = selectedPieceIndex;
                    const toIndex = i;

                    if (toIndex === fromIndex) { // Clicked the same piece again: deselect
                        selectedPieceIndex = null;
                        updateStatus('已取消选择.');
                        drawBoard();
                    } else if (clientGameBoard[toIndex] === myPlayerId) { // Clicked another of own pieces: reselect
                        selectedPieceIndex = toIndex;
                        updateStatus(`已选择你的棋子 ${toIndex}. 请点击一个相邻的空位移动.`);
                        drawBoard();
                    } else if (clientGameBoard[toIndex] === 0) { // Clicked an empty spot: attempt move
                        // Client-side adjacency check can be added here for immediate feedback, 
                        // but server will do the authoritative check.
                        ws.send(JSON.stringify({ type: 'move_piece', roomId: currentRoomId, fromIndex: fromIndex, toIndex: toIndex }));
                        updateStatus(`尝试移动棋子从 ${fromIndex} 到 ${toIndex}...`);
                        // selectedPieceIndex will be cleared by server 'update' message or error handling
                    } else { // Clicked opponent's piece as destination
                        updateStatus('不能移动到对方棋子占据的位置.', true);
                        // Optionally deselect: selectedPieceIndex = null; drawBoard(); 
                    }
                }
            }
            break; 
        }
    }
});

// Initial setup
// drawBoard(); // 不在初始时绘制，因为canvas是隐藏的
createRoomBtn.disabled = true;
joinRoomBtn.disabled = true;
roomIdInput.disabled = true;
connectToServer(); // Automatically try to connect on page load 