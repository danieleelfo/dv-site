const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// BN2 v2 — stessa logica di v1 su porta 3001, piu' gli eventi con
// immagine random: /random/<evento> sceglie a caso un file tra
// public/assets/events/<evento>/*.jpg|png|webp. Se la cartella non
// esiste o e' vuota, fa fallback sugli asset di v1 (bn2Win*.jpg etc.),
// cosi' il gioco funziona da subito e le nuove foto si aggiungono
// buttandole nella cartella, senza toccare codice.

const PORT = 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 30000,  // Più tolleranza per i telefoni
  pingInterval: 10000
});

app.use(express.static(path.join(__dirname, 'public')));

// Fallback: asset di v1 (bn2Win1.jpg, bn2Lose1.jpg, bn2Init*.jpg...)
app.use('/fallback', express.static(path.join(__dirname, '..', 'bn2', 'public', 'assets')));

const IMG_RE = /\.(jpe?g|png|webp)$/i;
// Eventi riconosciuti + prefisso dei file di v1 da usare come fallback.
const EVENTS = {
  win:     { prefix: /^bn2Win/i },
  lose:    { prefix: /^bn2Lose/i },
  init:    { prefix: /^bn2Init(?!P)/i },
  colpito: null,   // niente fallback: senza foto, nessun flash
  sparato: null,
};

app.get('/random/:event', (req, res) => {
  const ev = req.params.event;
  const def = EVENTS[ev];
  if (!def && !(ev in EVENTS)) {
    return res.status(404).json({ error: 'evento sconosciuto' });
  }

  const dir = path.join(__dirname, 'public', 'assets', 'events', ev);
  try {
    const files = fs.readdirSync(dir).filter((f) => IMG_RE.test(f));
    if (files.length) {
      const f = files[Math.floor(Math.random() * files.length)];
      return res.json({ url: '/assets/events/' + ev + '/' + encodeURIComponent(f) });
    }
  } catch (e) { /* cartella ancora da creare: fallback */ }

  if (def && def.prefix) {
    try {
      const flat = fs
        .readdirSync(path.join(__dirname, '..', 'bn2', 'public', 'assets'))
        .filter((f) => IMG_RE.test(f) && def.prefix.test(f));
      if (flat.length) {
        const f = flat[Math.floor(Math.random() * flat.length)];
        return res.json({ url: '/fallback/' + encodeURIComponent(f) });
      }
    } catch (e) { /* v1 senza asset: niente immagine */ }
  }
  res.json({ url: null });
});

// Gestione ruoli identica a v1
let p1Id = null;
let p2Id = null;
let readyPlayers = new Set();

io.on('connection', (socket) => {
  if (!p1Id) {
    p1Id = socket.id;
    socket.emit('role', 'P1');
  } else if (!p2Id) {
    p2Id = socket.id;
    socket.emit('role', 'P2');
  } else {
    socket.emit('message', 'Stanza piena o riconnessione in corso... Se sei bloccato, attendi 2 secondi e ricarica.');
  }

  socket.on('disconnect', () => {
    readyPlayers.delete(socket.id);
    if (socket.id === p1Id) p1Id = null;
    if (socket.id === p2Id) p2Id = null;
    socket.broadcast.emit('status_change', "L'avversario ha un tentennamento di rete...");
  });

  socket.on('player_ready', () => {
    readyPlayers.add(socket.id);
    socket.broadcast.emit('enemy_ready');
    if (readyPlayers.size >= 2) {
      io.emit('start_game');
      console.log('Partita avviata!');
    }
  });

  socket.on('shoot', (coords) => {
    socket.broadcast.emit('enemy_shoot', coords);
  });

  socket.on('shot_result', (data) => {
    socket.broadcast.emit('shot_result', data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('⚓ BN2 v2 attivo sulla porta ' + PORT + '!');
});
