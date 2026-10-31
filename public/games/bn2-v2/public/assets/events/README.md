# Cartelle eventi bn2-v2

Il server espone `GET /random/<evento>` e sceglie a caso un'immagine tra
quelle presenti qui dentro. Formati: jpg, png, webp. Nome file libero.

Cartelle (creale se non ci sono, il server le tollera assenti):

- `init/`    — sfondo mare iniziale (pagina + overlay start). Obiettivo: 8.
- `win/`     — schermata vittoria. Obiettivo: 8.
- `lose/`    — schermata sconfitta. Obiettivo: 8.
- `colpito/` — flash a schermo intero quando UN colpo va a segno (~0.7s). Obiettivo: 8.
- `sparato/` — flash quando un colpo finisce in acqua (~0.45s). Obiettivo: 8.

Fallback: finché `init/win/lose` sono vuote, il server serve le foto di v1
(bn2Init*.jpg, bn2Win*.jpg, bn2Lose1.jpg). Per colpito/sparato niente
fallback: senza foto non c'è flash, il gioco resta quello di prima.

## Prompt pronti per ImageLab (GraDV) — formato 1280x720, 8 varianti a evento

init: calm dark ocean at dawn, lone warship on patrol, soft fog, painted
digital illustration, cinematic — poi varia: alba dorata / notte con luna /
tempesta lontana / banco di nebbia...

win: victorious naval fleet at sunset, warships returning home with flags,
dramatic golden light rays, seagulls, painted digital illustration, epic,
cinematic — varianti: notte con riflettori, arcobaleno dopo la tempesta...

lose: sinking battleship in dark stormy sea, heavy rain, smoke and fire,
somber mood, painted digital illustration, cinematic — varianti: alba
grigia, nebbia fitta, onde giganti.

colpito: close-up explosion on a warship deck, fire and water blast at
night, cinematic painted illustration — varianti: giorno, nebbia,
_fuochi d'artificio_ di colpi multipli.

sparato: naval shell landing in the ocean, huge white water splash column,
sea mist, cinematic painted illustration — varianti: sunrise, storm,
splash con gabbiani spaventati.
