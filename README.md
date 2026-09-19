### BassBuddy

----

Single-page Vue app that listens to a bass guitar through the microphone,
detects the played note using a Rust/WebAssembly pitch detector, and shows
where it sits on a bass fretboard. Combined with yaml-based, user modifiable
excersise files, it is a great practice partner to familiarize yourself with
the fretboard of your bass guitar.


### Run with Docker

----

No local Rust or Node toolchain needed — the image builds the wasm module
and the Vue app from source in isolated stages, then serves the static
result with nginx.

```sh
docker build -t bassbuddy .
docker run --rm -p 8080:80 bassbuddy
```

Open `http://localhost:8080`. Microphone access needs a secure context;
`localhost` qualifies even over plain HTTP, but reaching the container from
another device requires HTTPS in front of it.


### Disclaimer

----

This app was created using vibe-coding only.
