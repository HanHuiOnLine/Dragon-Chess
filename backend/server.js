const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();

app.use(express.static(path.join(__dirname, '../front')));


const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

let rooms = {};

console.log(`WebSocket server started on port ${PORT}`);

const POSSIBLE_LINES = [
    [0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0],
    [8, 9, 10], [10, 11, 12], [12, 13, 14], [14, 15, 8],
    [16, 17, 18], [18, 19, 20], [20, 21, 22], [22, 23, 16],
    [1, 9, 17], [3, 11, 19], [5, 13, 21], [7, 15, 23]
];

const ADJACENCY_LIST = [
    [1, 7, 8],      [0, 2, 9],      [1, 3, 10],     [2, 4, 11],
    [3, 5, 12],     [4, 6, 13],     [5, 7, 14],     [6, 0, 15],
    [0, 9, 15, 16], [1, 8, 10, 17], [2, 9, 11, 18], [3, 10, 12, 19],
    [4, 11, 13, 20], [5, 12, 14, 21], [6, 13, 15, 22], [7, 14, 8, 23],
    [8, 17, 23],    [9, 16, 18],    [10, 17, 19],   [11, 18, 20],
    [12, 19, 21],   [13, 20, 22],   [14, 21, 23],   [15, 22, 16]
];

function generateRoomId() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function isPiecePartOfAnyLine(board, pieceIndex, playerId) {
    if (board[pieceIndex] !== playerId) return false;
    for (const line of POSSIBLE_LINES) {
        if (line.includes(pieceIndex)) {
            if (board[line[0]] === playerId && board[line[1]] === playerId && board[line[2]] === playerId) {
                return true;
            }
        }
    }
    return false;
}

function checkLineFormation(board, playerId, movedPieceIndex) {
    for (const line of POSSIBLE_LINES) {
        if (line.includes(movedPieceIndex)) {
            if (board[line[0]] === playerId && board[line[1]] === playerId && board[line[2]] === playerId) {
                return true;
            }
        }
    }
    return false;
}

wss.on('connection', (ws) => {
    ws.roomId = null;
    ws.playerId = null;

    console.log('Client connected via WebSocket.');

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
            console.log('Received WebSocket message:', data);
        } catch (e) {
            console.error('Failed to parse WebSocket message or message is not JSON:', message, e);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid WebSocket message format.' }));
            return;
        }

        const room = ws.roomId ? rooms[ws.roomId] : null;

        switch (data.type) {
            case 'create_room':
                handleCreateRoom(ws);
                break;
            case 'join_room':
                handleJoinRoom(ws, data.roomId);
                break;
            case 'place_piece':
            case 'move_piece':
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Not in a room.' }));
                    return;
                }
                handleGameAction(ws, data, room);
                break;
            case 'capture_piece':
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Not in a room.' }));
                    return;
                }
                handleCapturePiece(ws, data, room);
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', message: 'Unknown WebSocket message type.' }));
        }
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected.');
        handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error: ${error.message}`);
        handleDisconnect(ws); 
    });
});

function handleCreateRoom(ws) {
    let roomId = generateRoomId();
    while (rooms[roomId]) { 
        roomId = generateRoomId();
    }

    ws.roomId = roomId;
    ws.playerId = 1;

    rooms[roomId] = {
        players: { 1: ws },
        gameBoard: Array(24).fill(0),
        currentPlayer: 1,
        placementPhase: true,
        piecesPlaced: [0, 0],
        MAX_PIECES: 9,
        playerCount: 1,
        gameState: 'waiting_for_opponent'
    };

    console.log(`Player 1 created and joined room ${roomId} via WebSocket`);
    ws.send(JSON.stringify({
        type: 'room_created',
        roomId: roomId,
        playerId: 1,
        board: rooms[roomId].gameBoard,
        currentPlayer: rooms[roomId].currentPlayer,
        placementPhase: rooms[roomId].placementPhase,
        piecesPlaced: rooms[roomId].piecesPlaced,
        gameState: rooms[roomId].gameState
    }));
}

function handleJoinRoom(ws, roomId) {
    if (!roomId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room ID is required to join.' }));
        return;
    }
    roomId = roomId.toUpperCase();
    const room = rooms[roomId];

    if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: `Room ${roomId} not found.` }));
        return;
    }

    if (room.playerCount >= 2) {
        ws.send(JSON.stringify({ type: 'error', message: `Room ${roomId} is full.` }));
        return;
    }

    ws.roomId = roomId;
    ws.playerId = 2; 
    room.players[2] = ws;
    room.playerCount++;
    room.gameState = 'playing';

    console.log(`Player 2 joined room ${roomId} via WebSocket`);

    const commonGameState = {
        roomId: roomId,
        board: room.gameBoard,
        currentPlayer: room.currentPlayer,
        placementPhase: room.placementPhase,
        piecesPlaced: room.piecesPlaced,
        gameState: room.gameState
    }

    ws.send(JSON.stringify({
        type: 'joined_room',
        playerId: 2,
        ...commonGameState
    }));

    broadcastToRoom(roomId, {
        type: 'game_start',
        message: 'Both players connected. Game starts!',
        ...commonGameState
    });
}

function getCapturablePieces(board, opponentPlayerId) {
    const capturable = [];
    for (let i = 0; i < board.length; i++) {
        if (board[i] === opponentPlayerId) {
            if (!isPiecePartOfAnyLine(board, i, opponentPlayerId)) {
                capturable.push(i);
            }
        }
    }
    return capturable;
}

function handleGameAction(ws, data, room) {
    const { playerId } = ws;

    if (room.gameState === 'awaiting_capture') {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid action: currently awaiting opponent piece capture.' }));
        return;
    }
    if (playerId !== room.currentPlayer) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn.' }));
        return;
    }

    let pieceIndexMovedOrPlaced = -1;
    let actionType = data.type;
    let moveDetails = {};

    if (actionType === 'place_piece') {
        if (!room.placementPhase) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not in placement phase.' }));
            return;
        }
        if (room.piecesPlaced[playerId - 1] >= room.MAX_PIECES) {
            ws.send(JSON.stringify({ type: 'error', message: 'All pieces already placed.' }));
            return;
        }
        const { index } = data;
        if (index === undefined || index < 0 || index >= room.gameBoard.length) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid piece index.' }));
            return;
        }
        if (room.gameBoard[index] === 0) {
            room.gameBoard[index] = playerId;
            room.piecesPlaced[playerId - 1]++;
            pieceIndexMovedOrPlaced = index;
            moveDetails = { player: playerId, action: actionType, index: index };
        } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Spot already taken.' }));
            return;
        }
    } else if (actionType === 'move_piece') {
        if (room.placementPhase) {
            ws.send(JSON.stringify({ type: 'error', message: 'Still in placement phase.' }));
            return;
        }
        const { fromIndex, toIndex } = data;
        if (fromIndex === undefined || toIndex === undefined || 
            fromIndex < 0 || fromIndex >= room.gameBoard.length || 
            toIndex < 0 || toIndex >= room.gameBoard.length ){
             ws.send(JSON.stringify({ type: 'error', message: 'Invalid move indices.' }));
            return;
        }
        if (room.gameBoard[fromIndex] === playerId && 
            room.gameBoard[toIndex] === 0 &&
            ADJACENCY_LIST[fromIndex].includes(toIndex)) {
            
            room.gameBoard[fromIndex] = 0;
            room.gameBoard[toIndex] = playerId;
            pieceIndexMovedOrPlaced = toIndex;
            moveDetails = { player: playerId, action: actionType, from: fromIndex, to: toIndex };
        } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid move. Check piece ownership, target empty, and adjacency.' }));
            return;
        }
    }

    if (pieceIndexMovedOrPlaced !== -1 && checkLineFormation(room.gameBoard, playerId, pieceIndexMovedOrPlaced)) {
        console.log(`Player ${playerId} formed a line in room ${ws.roomId} at index ${pieceIndexMovedOrPlaced} (WebSocket)`);
        const opponentPlayerId = (playerId === 1) ? 2 : 1;
        const capturablePieces = getCapturablePieces(room.gameBoard, opponentPlayerId);

        if (capturablePieces.length > 0) {
            room.gameState = 'awaiting_capture';
            ws.send(JSON.stringify({
                type: 'line_formed_capture_pending',
                message: 'You formed a line! Select an opponent piece to capture.',
                board: room.gameBoard,
                currentPlayer: room.currentPlayer, 
                placementPhase: room.placementPhase,
                piecesPlaced: room.piecesPlaced,
                capturablePieces: capturablePieces,
                gameState: room.gameState
            }));
            const opponentWS = room.players[opponentPlayerId];
            if (opponentWS && opponentWS.readyState === WebSocket.OPEN) {
                opponentWS.send(JSON.stringify({
                    type: 'opponent_awaiting_capture',
                    message: `Opponent (Player ${playerId}) formed a line and is selecting a piece to capture.`,
                    board: room.gameBoard,
                    currentPlayer: room.currentPlayer, 
                    placementPhase: room.placementPhase,
                    piecesPlaced: room.piecesPlaced,
                    gameState: room.gameState
                }));
            }
            return; 
        } else {
            console.log(`Player ${playerId} formed a line, but no capturable pieces for opponent ${opponentPlayerId} (WebSocket).`);
        }
    }

    room.currentPlayer = (room.currentPlayer === 1) ? 2 : 1;
    if (room.placementPhase && room.piecesPlaced[0] >= room.MAX_PIECES && room.piecesPlaced[1] >= room.MAX_PIECES) {
        room.placementPhase = false;
        console.log(`Room ${ws.roomId}: Placement phase ended. Moving to move phase (WebSocket).`);
    }

    broadcastToRoom(ws.roomId, {
        type: 'update',
        board: room.gameBoard,
        currentPlayer: room.currentPlayer,
        placementPhase: room.placementPhase,
        piecesPlaced: room.piecesPlaced,
        gameState: room.gameState,
        lastMove: moveDetails
    });
}

function handleCapturePiece(ws, data, room) {
    const { playerId } = ws;
    const { index: pieceToCaptureIndex } = data;

    if (room.gameState !== 'awaiting_capture' || playerId !== room.currentPlayer) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn to capture or game not in capture state.' }));
        return;
    }

    const opponentPlayerId = (playerId === 1) ? 2 : 1;
    if (pieceToCaptureIndex === undefined || room.gameBoard[pieceToCaptureIndex] !== opponentPlayerId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid piece selected for capture.' }));
        return;
    }
    if (isPiecePartOfAnyLine(room.gameBoard, pieceToCaptureIndex, opponentPlayerId)){
        ws.send(JSON.stringify({ type: 'error', message: 'Cannot capture a piece that is part of an opponent\'s line.' }));
        return;
    }

    console.log(`Player ${playerId} captures piece at index ${pieceToCaptureIndex} from Player ${opponentPlayerId} in room ${ws.roomId} (WebSocket)`);
    room.gameBoard[pieceToCaptureIndex] = 0;
    room.gameState = 'playing';
    room.currentPlayer = opponentPlayerId;

    if (room.placementPhase && room.piecesPlaced[0] >= room.MAX_PIECES && room.piecesPlaced[1] >= room.MAX_PIECES) {
        room.placementPhase = false;
        console.log(`Room ${ws.roomId}: Placement phase ended post-capture. Moving to move phase (WebSocket).`);
    }

    broadcastToRoom(ws.roomId, {
        type: 'update',
        board: room.gameBoard,
        currentPlayer: room.currentPlayer,
        placementPhase: room.placementPhase,
        piecesPlaced: room.piecesPlaced,
        gameState: room.gameState,
        lastMove: { player: playerId, action: 'capture', capturedIndex: pieceToCaptureIndex }
    });
}

function handleDisconnect(ws) {
    const { roomId, playerId } = ws;
    if (roomId && rooms[roomId]) {
        console.log(`Player ${playerId} disconnected from room ${roomId} (WebSocket)`);
        const room = rooms[roomId];
        if (room.players[playerId]) {
            delete room.players[playerId];
            room.playerCount--;
        }

        if (room.playerCount < 2 && room.gameState !== 'ended') {
            const remainingPlayerKey = Object.keys(room.players)[0];
            if (remainingPlayerKey) {
                const remainingWS = room.players[remainingPlayerKey];
                if (remainingWS && remainingWS.readyState === WebSocket.OPEN) {
                    remainingWS.send(JSON.stringify({
                        type: 'opponent_disconnected',
                        message: 'Opponent disconnected. The game in this room has ended.',
                        gameState: 'ended'
                    }));
                }
            }
            console.log(`Room ${roomId} is being closed due to disconnection or game end (WebSocket).`);
            delete rooms[roomId]; 
        } else if (room.playerCount >=2) {
            console.log(`Player ${playerId} (perhaps a spectator later) left room ${roomId}, ${room.playerCount} players remaining (WebSocket).`);
        } else {
             console.log(`Room ${roomId} is being closed or was already empty/ended (WebSocket).`);
             delete rooms[roomId];
        }
    } else {
        console.log('A client disconnected before joining a room (WebSocket).');
    }
}

function broadcastToRoom(roomId, data, excludePlayerId = null) {
    const room = rooms[roomId];
    if (!room) return;

    const message = JSON.stringify(data);
    const excludedInfo = excludePlayerId ? ` (excluding P${excludePlayerId})` : '';
    console.log(`Broadcasting WebSocket message to room ${roomId}${excludedInfo}: ${message}`);

    Object.entries(room.players).forEach(([pid, playerWs]) => {
        if (playerWs && playerWs.readyState === WebSocket.OPEN) { 
            if (excludePlayerId === null || parseInt(pid) !== excludePlayerId) {
                playerWs.send(message);
            }
        }
    });
}

server.listen(PORT, () => {
    console.log(`Express HTTP and WebSocket server started on port ${PORT}`);
    console.log(`Access the game at http://localhost:${PORT}`);
}); 