### BassBuddy

----

Single-page Vue app that listens to a bass guitar through the microphone,
detects the played note using a Rust/WebAssembly pitch detector, and shows
where it sits on a bass fretboard. Combined with yaml-based, user modifiable
exercise files, it is a great practice partner to familiarize yourself with
the fretboard of your bass guitar.

<img width="1030" height="640" alt="image" src="https://github.com/user-attachments/assets/41fbe425-a37b-4a9b-98d2-68b9f21a188e" />

Try it out at: <https://qtc-de.github.io/BassBuddy/>


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


### Excersises

----

The preconfigured excersises are only examples an will be improved over time.
To write your own excersises please read the [excersise documentation](docs/excersises.md).

You created a useful excersise? Feel free to contribute it to this repository :)


### Disclaimer

----

This app was created using vibe-coding only.
