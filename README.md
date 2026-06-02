# Multiplayer Texas Hold 'Em

[![GitHub license](https://img.shields.io/github/license/Naereen/StrapDown.js.svg)](https://github.com/ptwu/distributed-texasholdem/blob/master/LICENSE)
![1.0.0](https://img.shields.io/badge/version-1.0.0-blue.svg)
![CI](https://github.com/ptwu/distributed-texasholdem/workflows/CI/badge.svg)

Using `pnpm`, `Vite`, `Svelte`, `ElysiaJS`, and Cloudflare Workers Durable Objects to make a distributed poker game. Allows for multiple gameplay rooms simultaneously across different devices.

![Image of Distributed Texas Hold Em Gameplay](https://i.imgur.com/eGj6iHU.png)
![Image of Distributed Texas Hold Em Lobby](https://i.imgur.com/TCusHG0.png)

## Commands

`pnpm install` installs all dependencies required to run the webapp.

`pnpm dev` starts the Vite Svelte client.

`pnpm dev:worker` starts the Cloudflare Worker locally with Wrangler.

`pnpm test` evaluates the unit tests located in test/classes/.

`pnpm format` formats the project with `oxfmt`.

`pnpm lint` checks the project with `oxlint`.

`pnpm deploy` builds the Vite app and deploys the Worker with Wrangler.
