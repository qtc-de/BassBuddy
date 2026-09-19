### Prerequisites

----

Either [Docker](https://docs.docker.com/get-docker/) (see [Run with
Docker](#run-with-docker) below and skip everything else), or a local
toolchain:

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) with the `wasm32-unknown-unknown` target:
  ```sh
  rustup target add wasm32-unknown-unknown
  ```
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/):
  ```sh
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
  ```

The compiled wasm output is already checked into `src/pitch-wasm/`, so these
are only required if you change the Rust code and need to rebuild it.

## Setup

```sh
npm install
```

## Build the WebAssembly pitch detector

Only needed after editing anything under `pitch-wasm/`:

```sh
npm run build:wasm
```

This runs `wasm-pack build` and writes the compiled module into
`src/pitch-wasm/`, which the Vue app imports directly.

## Run in development

```sh
npm run dev
```

Vite prints a local URL (default `http://localhost:5173`). Open it in a
browser, click **Start Listening**, and allow microphone access. Play a
note on a bass — the note name, frequency, tuning meter, and fretboard
position update live. Use the **Algorithm** dropdown to switch pitch
detectors on the fly, the **Show note names** checkbox to label each
highlighted fretboard circle with its note (persisted in the browser via
`localStorage`), and the **Noise Gate** slider if quiet string noise (e.g.
barely brushing a string) keeps registering as a note — raise it to
require a firmer pluck, or lower it to catch softer notes.

Microphone access requires a secure context: `localhost` works out of the
box, but accessing the dev server from another device needs HTTPS or a
tunnel.

## Build for production

```sh
npm run build
```

Outputs a static bundle to `dist/`. Preview it locally with:

```sh
npm run preview
```
