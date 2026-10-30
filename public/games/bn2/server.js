const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 30000,  // Più tolleranza per i telefoni
  pingInterval: 10000
});

const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// Gestiamo i ruoli in modo dinamico
let p1Id = null;
let p2Id = null;
let readyPlayers = new Set();

io.on('connection', (socket) => {
  // Assegna il ruolo a chi si connette basandosi sui posti liberi
  if (!p1Id) {
    p1Id = socket.id;
    socket.emit('role', 'P1');
    console.log(`Giocatore 1 connesso: ${socket.id}`);
  } else if (!p2Id) {
    p2Id = socket.id;
    socket.emit('role', 'P2');
    console.log(`Giocatore 2 connesso: ${socket.id}`);
  } else {
    // Se i posti sono pieni ma è solo una riconnessione fantasma, non lo buttiamo fuori subito
    socket.emit('message', 'Stanza piena o riconnessione in corso... Se sei bloccato, attendi 2 secondi e ricarica.');
  }

  socket.on('disconnect', () => {
    console.log(`Disconnesso temporaneamente: ${socket.id}`);
    readyPlayers.delete(socket.id);
    
    if (socket.id === p1Id) p1Id = null;
    if (socket.id === p2Id) p2Id = null;
    
    // Avvisa ma senza resettare brutalmente la partita all'istante
    socket.broadcast.emit('status_change', 'L\'avversario ha un tentennamento di rete...');
  });

  socket.on('player_ready', () => {
    readyPlayers.add(socket.id);
    console.log(`Pronto: ${socket.id}. Totale pronti: ${readyPlayers.size}/2`);
    
    socket.broadcast.emit('enemy_ready');

    // Avvia solo se ci sono due entità pronte
    if (readyPlayers.size >= 2) {
      io.emit('start_game');
      console.log('Partita avviata!');
    }
  });

  socket.on('shoot', (coords) => {
    // Invia lo sparo a tutti gli altri dispositivi connessi
    socket.broadcast.emit('enemy_shoot', coords);
  });

  socket.on('shot_result', (data) => {
    socket.broadcast.emit('shot_result', data);
  });
});

server.listen(3000, '0.0.0.0', () => {
  console.log('⚓ Server Antidisconnessione attivo sulla porta 3000!');
});
