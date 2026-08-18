# Retro Arcade

Retro Arcade è una macchina arcade virtuale completa, vista frontalmente e costruita come un oggetto fisico: cabinet, marquee illuminata, monitor CRT, joystick animato, pulsanti meccanici, coin slot, crediti, audio sintetizzato e sette giochi originali. Tutto funziona in una singola applicazione, senza ricaricare la pagina.

## Features

- Cabinet arcade responsive con prospettiva, pannello comandi inclinato, speaker, viti, metallo, plastiche, riflessi, usura leggera e sala giochi sullo sfondo.
- Monitor CRT 384×288 con pixel scaling, scanline, vignette, rumore, RGB mask, glow, flicker delicato, riflesso sul vetro e sequenze di accensione/spegnimento.
- Boot sequence, menu arcade, transizioni analogiche, attract mode, crediti, free play, pausa, game over e Hall of Fame.
- Joystick fisico inclinabile in otto direzioni; pulsanti A/B/C, START e COIN animati e cliccabili.
- Input simultaneo da tastiera, mouse, touch/pointer e joystick trascinabile, sempre instradato da un unico `InputManager`.
- Audio originale generato in tempo reale con Web Audio API: click, moneta, spari, esplosioni, power-up, line clear, game over e ronzio CRT.
- High score indipendenti, impostazioni e statistiche salvati localmente.
- Loop unico con `requestAnimationFrame`, delta time limitato e Canvas 2D senza smoothing.

## Games

### Maze Chaser

Labirinto originale con dots, power core, tunnel, quattro avversari dotati di comportamenti differenti, combo sugli avversari vulnerabili, vite e livelli progressivi.

### Star Invaders

Shooter a formazione con 50 invasori, velocità crescente, proiettili nemici, barriere distruttibili a pixel, UFO bonus, esplosioni, vite e ondate successive.

### Vector Rocks

Shooter vettoriale con rotazione, spinta, inerzia, wrapping toroidale, hyperspace e asteroidi grandi, medi e piccoli che si dividono quando colpiti.

### Block Breaker

Paddle e palline con layout multipli, blocchi normali, resistenti, bonus e indistruttibili. Include power-up per paddle, velocità, multiball e vita extra.

### Retro Pong

Duello minimale contro una CPU con limite di velocità, tempo di reazione ed errore variabile. Angolo e velocità della pallina cambiano in base al punto d’impatto.

### Falling Blocks

Puzzle con sette tetramini, preview NEXT, HOLD, rotazione oraria e antioraria, wall kick, soft drop, hard drop, combo, line clear multipli e progressione di livello.

### Neon Snake

Snake al neon con movimento anti-inversione, cibo normale e bonus temporanei, turbo, ostacoli progressivi, layout convalidati e velocità crescente.

## Controls

| Control | Keyboard | Cabinet |
| --- | --- | --- |
| Move | Arrow Keys / WASD | Joystick |
| Button A | Z | A |
| Button B | X | B |
| Button C | C | C |
| Start / Confirm | Enter | START |
| Insert Coin | 5 | Coin slot |
| Pause / Back | Esc | — |
| Fullscreen | F | Settings |

In Falling Blocks: sinistra/destra muovono il pezzo, giù effettua il soft drop, su o A ruota in senso orario, B ruota in senso antiorario e C esegue l’hard drop.

## Installation

Richiede Node.js moderno (consigliato Node 22 o successivo).

```bash
npm install
npm run dev
```

Aprire l’indirizzo locale mostrato da Vite. Il primo input dell’utente sblocca l’audio, come richiesto dai browser moderni.

## Production Build

```bash
npm run build
```

Il risultato di produzione viene generato nella cartella `dist/`.

Per eseguire build e verifiche automatiche insieme:

```bash
npm test
```

## Project Structure

```text
src/
  core/
    ArcadeMachine.ts     state machine e loop centrale
    AudioManager.ts      sintesi Web Audio
    CreditManager.ts     monete e free play
    GameManager.ts       ciclo di vita dei giochi
    InputManager.ts      tastiera e controlli fisici
    StateManager.ts      stati applicativi
    StorageManager.ts    high score, settings e stats
  games/
    BaseGame.ts
    maze-chaser/
    star-invaders/
    vector-rocks/
    block-breaker/
    retro-pong/
    falling-blocks/
    neon-snake/
  ui/
    Cabinet.ts           struttura fisica e controlli
  styles/
    global.css           cabinet, sala giochi e CRT
  main.ts
```

## Architecture

`ArcadeMachine` mantiene un’unica state machine (`BOOTING`, `MAIN_MENU`, `GAME_LOADING`, `PLAYING`, `PAUSED`, `GAME_OVER`, `ATTRACT_MODE`, `SETTINGS`, `HALL_OF_FAME`, `POWER_OFF`) e un unico game loop. `GameManager` carica un gioco alla volta; tutti i giochi implementano la stessa interfaccia e ricevono soltanto lo snapshot di input e servizi controllati.

La catena degli input è sempre:

```text
Keyboard / Pointer
        ↓
   InputManager
        ↓
 Game + Cabinet animation + Audio feedback
```

I giochi non registrano event listener propri. Cambiare gioco distrugge correttamente l’istanza precedente e non avvia loop o timer di rendering aggiuntivi.

## High Scores and Settings

Ogni gioco ha un record indipendente. High score, volumi, mute, intensità CRT, scanline, flicker, RGB shift, glow, free play e statistiche vengono salvati in `localStorage` sotto una singola chiave versionata. Se lo storage non è disponibile, la macchina resta interamente giocabile per la sessione corrente.

Dal menu Settings è possibile regolare gli effetti, attivare il fullscreen e azzerare tutti gli high score. La perdita di focus mette automaticamente in pausa una partita in corso.

## Copyright

Questo progetto contiene esclusivamente codice, grafica procedurale e suoni originali. I giochi reinterpretano generi arcade storici senza distribuire ROM, emulatori, loghi, musiche, sprite o asset originali di prodotti commerciali. Tutti i nomi e gli elementi visivi presenti nel progetto sono stati creati per Retro Arcade.
