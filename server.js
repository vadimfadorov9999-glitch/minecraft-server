import { WebSocketServer } from 'ws';
import http from 'http';

// ============================================================
//  HTTP-СЕРВЕР (нужен Render для проверки живости)
// ============================================================
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'ok',
        service: 'minecraft-server',
        players: players.size,
        uptime: Math.floor(process.uptime())
    }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});

// ============================================================
//  WEBSOCKET
// ============================================================
const wss = new WebSocketServer({ server });

const players = new Map();      // id -> { x, y, z, rotY, name, color }
const worldBlocks = new Map();  // "x,y,z" -> blockType — сохраняем изменения
let nextId = 1;

const COLORS = [0x3355aa, 0xaa3355, 0x33aa55, 0xaa8833, 0x8833aa, 0x33aaaa, 0xaa5533];

wss.on('connection', (ws) => {
    const id = nextId++;
    const color = COLORS[(id - 1) % COLORS.length];

    players.set(id, {
        x: 16.5, y: 10, z: 16.5, rotY: 0,
        name: `Игрок${id}`,
        color
    });

    ws.userId = id;
    ws.isAlive = true;

    console.log(`[+] Игрок ${id}. Онлайн: ${players.size}`);

    // Отправляем новому игроку его ID, список игроков, изменения блоков
    ws.send(JSON.stringify({
        type: 'init',
        myId: id,
        players: Array.from(players.entries()).map(([pid, p]) => ({ id: pid, ...p })),
        changedBlocks: Array.from(worldBlocks.entries())
    }));

    // Оповещаем всех о новом игроке
    broadcast({
        type: 'player_join',
        id,
        player: players.get(id)
    }, ws);

    // --- Приём сообщений ---
    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const player = players.get(id);
        if (!player) return;

        switch (msg.type) {
            case 'move':
                player.x = msg.x;
                player.y = msg.y;
                player.z = msg.z;
                player.rotY = msg.rotY;
                broadcast({
                    type: 'player_move',
                    id,
                    x: msg.x, y: msg.y, z: msg.z, rotY: msg.rotY
                }, ws);
                break;

            case 'block_place': {
                const key = `${msg.x},${msg.y},${msg.z}`;
                worldBlocks.set(key, msg.blockType);
                broadcast({
                    type: 'block_place',
                    x: msg.x, y: msg.y, z: msg.z,
                    blockType: msg.blockType
                }, ws);
                break;
            }

            case 'block_break': {
                const key = `${msg.x},${msg.y},${msg.z}`;
                worldBlocks.delete(key);
                broadcast({
                    type: 'block_break',
                    x: msg.x, y: msg.y, z: msg.z
                }, ws);
                break;
            }

            case 'chat':
                broadcast({
                    type: 'chat',
                    id,
                    name: player.name,
                    text: String(msg.text).slice(0, 200),
                    color: player.color
                });
                break;

            case 'set_name':
                player.name = String(msg.name).slice(0, 16) || `Игрок${id}`;
                broadcast({
                    type: 'player_name',
                    id,
                    name: player.name
                });
                break;

            case 'pong':
                ws.isAlive = true;
                break;
        }
    });

    ws.on('close', () => {
        players.delete(id);
        broadcast({ type: 'player_leave', id });
        console.log(`[-] Игрок ${id}. Онлайн: ${players.size}`);
    });

    ws.on('error', (err) => {
        console.error(`[!] Ошибка у ${id}:`, err.message);
    });
});

function broadcast(msg, exclude = null) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
        if (client !== exclude && client.readyState === 1) {
            client.send(data);
        }
    }
}

// Пинг для отсеивания мёртвых соединений
setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }
}, 30000);

console.log('🎮 WebSocket-сервер готов');