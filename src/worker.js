import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import Game from "./classes/game.js";

const app = new Elysia({ adapter: CloudflareAdapter })
  .get("/api/health", () => ({
    ok: true,
    service: "distributed-texasholdem",
  }))
  .compile();

const parseMessage = (raw) => {
  try {
    const message = JSON.parse(raw);
    if (!message || typeof message.event !== "string") return null;
    return message;
  } catch {
    return null;
  }
};

const reconnectGraceMs = 60_000;

const createSocketAdapter = (id, webSocket) => ({
  id,
  sessionToken: null,
  emit(event, payload) {
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify({ event, payload }));
    }
  },
});

export class PokerRoom {
  constructor() {
    this.rooms = [];
    this.sessions = new Map();
  }

  async fetch(request) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    const socket = createSocketAdapter(id, server);

    server.accept();
    this.sessions.set(server, socket);
    server.addEventListener("message", (event) => {
      this.handleMessage(socket, String(event.data));
    });
    server.addEventListener("close", () => this.disconnect(socket));
    server.addEventListener("error", () => this.disconnect(socket));

    socket.emit("connected", { id });
    return new Response(null, { status: 101, webSocket: client });
  }

  handleMessage(socket, raw) {
    const message = parseMessage(raw);
    if (!message) {
      socket.emit("errorMessage", { message: "Invalid message." });
      return;
    }

    const data = message.payload ?? {};
    switch (message.event) {
      case "host":
        this.host(socket, data);
        break;
      case "join":
        this.join(socket, data);
        break;
      case "resume":
        this.resume(socket, data);
        break;
      case "leave":
        this.leave(socket);
        break;
      case "startGame":
        this.startGame(socket, data);
        break;
      case "evaluatePossibleMoves":
        this.evaluatePossibleMoves(socket);
        break;
      case "raiseModalData":
        this.raiseModalData(socket);
        break;
      case "startNextRound":
        this.startNextRound(socket);
        break;
      case "moveMade":
        this.moveMade(socket, data);
        break;
      default:
        socket.emit("errorMessage", { message: `Unknown event: ${message.event}` });
    }
  }

  host(socket, data) {
    if (!this.isValidUsername(data.username)) {
      socket.emit("hostRoom", undefined);
      return;
    }

    let code;
    do {
      code = Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join("");
    } while (this.rooms.some((room) => room.getCode() === code));

    const sessionToken = this.sessionToken(data.sessionToken);
    socket.sessionToken = sessionToken;
    socket.gameCode = code;
    socket.username = data.username;

    const game = new Game(code, data.username);
    this.rooms.push(game);
    const player = game.addPlayer(data.username, socket);
    player.sessionToken = sessionToken;
    player.disconnected = false;
    game.emitPlayers("hostRoom", {
      code,
      players: game.getPlayersArray(),
      session: { code, username: data.username, token: sessionToken },
    });
  }

  join(socket, data) {
    const game = this.rooms.find((room) => room.getCode() === String(data.code ?? ""));
    const username = data.username;
    if (game && this.resumePlayer(socket, game, username, data.sessionToken)) return;

    if (
      !game ||
      !this.isValidUsername(username) ||
      game.getPlayersArray().includes(username) ||
      game.getPlayersArray().length >= 11
    ) {
      socket.emit("joinRoom", undefined);
      return;
    }

    const sessionToken = this.sessionToken(data.sessionToken);
    socket.sessionToken = sessionToken;
    socket.gameCode = game.getCode();
    socket.username = username;

    const player = game.addPlayer(username, socket);
    player.sessionToken = sessionToken;
    player.disconnected = false;
    socket.emit("joinRoom", {
      host: game.getHostName(),
      players: game.getPlayersArray(),
      session: { code: game.getCode(), username, token: sessionToken },
    });
    game.emitPlayers("hostRoom", {
      code: game.getCode(),
      players: game.getPlayersArray(),
    });
  }

  resume(socket, data) {
    const game = this.rooms.find((room) => room.getCode() === String(data.code ?? ""));
    if (!game || !this.resumePlayer(socket, game, data.username, data.token)) {
      socket.emit("resumeFailed", { message: "No reconnectable session found." });
    }
  }

  resumePlayer(socket, game, username, token) {
    const player = game.players.find(
      (candidate) =>
        candidate.getUsername() === username &&
        candidate.sessionToken &&
        candidate.sessionToken === token,
    );
    if (!player) return false;

    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }

    socket.sessionToken = token;
    socket.gameCode = game.getCode();
    socket.username = username;
    player.socket = socket;
    player.disconnected = false;

    socket.emit("resumed", {
      code: game.getCode(),
      username,
      token,
      players: game.getPlayersArray(),
      host: game.getHostName(),
      isHost: game.getHostName() === username,
      roundStarted: game.roundNum > 0,
    });

    if (game.roundNum > 0) {
      socket.emit("gameBegin", { code: game.getCode() });
      game.refreshCards();
      game.rerender();
    } else if (game.getHostName() === username) {
      socket.emit("hostRoom", {
        code: game.getCode(),
        players: game.getPlayersArray(),
        session: { code: game.getCode(), username, token },
      });
    } else {
      socket.emit("joinRoom", {
        host: game.getHostName(),
        players: game.getPlayersArray(),
        session: { code: game.getCode(), username, token },
      });
    }

    game.emitPlayers("playerReconnected", { player: username });
    return true;
  }

  startGame(socket, data) {
    const game = this.rooms.find((room) => room.getCode() === String(data.code ?? ""));
    if (!game) {
      socket.emit("gameBegin", undefined);
      return;
    }

    game.emitPlayers("gameBegin", { code: game.getCode() });
    game.startGame();
  }

  leave(socket) {
    const game = this.findGameBySocket(socket);
    if (!game) {
      socket.emit("exited", {});
      return;
    }

    const player = game.findPlayer(socket.id);
    if (!player || player.socket?.id !== socket.id) {
      socket.emit("exited", {});
      return;
    }

    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }

    game.disconnectPlayer(player);
    if (game.players.length === 0) {
      this.rooms = this.rooms.filter((room) => room !== game);
    }

    socket.sessionToken = null;
    socket.gameCode = null;
    socket.username = null;
    socket.emit("exited", {});
  }

  evaluatePossibleMoves(socket) {
    const game = this.findGameBySocket(socket);
    if (game?.roundInProgress) {
      socket.emit("displayPossibleMoves", game.getPossibleMoves(socket));
    }
  }

  raiseModalData(socket) {
    const game = this.findGameBySocket(socket);
    const player = game?.findPlayer(socket.id);
    if (game && player) {
      socket.emit("updateRaiseModal", {
        topBet: game.getCurrentTopBet(),
        usernameMoney: game.getPlayerBetInStage(player) + player.getMoney(),
      });
    }
  }

  startNextRound(socket) {
    const game = this.findGameBySocket(socket);
    if (game && !game.roundInProgress) {
      game.startNewRound();
    }
  }

  moveMade(socket, data) {
    const game = this.findGameBySocket(socket);
    if (!game) {
      socket.emit("errorMessage", { message: "Can't find game." });
      return;
    }

    const move = data.move;
    const bet = Number(data.bet);
    if (move === "fold") game.fold(socket);
    if (move === "check") game.check(socket);
    if (move === "bet") game.bet(socket, bet);
    if (move === "call") game.call(socket);
    if (move === "raise") game.raise(socket, bet);
  }

  disconnect(socket) {
    const game = this.findGameBySocket(socket);
    if (!game) return;

    const player = game.findPlayer(socket.id);
    if (!player || player.socket?.id !== socket.id) return;

    player.disconnected = true;
    game.emitPlayers("playerDisconnected", { player: player.getUsername() });
    player.reconnectTimer = setTimeout(() => {
      if (!player.disconnected || player.socket?.id !== socket.id) return;
      game.disconnectPlayer(player);
      if (game.players.length === 0) {
        this.rooms = this.rooms.filter((room) => room !== game);
      }
    }, reconnectGraceMs);
  }

  findGameBySocket(socket) {
    return this.rooms.find((room) => room.findPlayer(socket.id).socket.id === socket.id);
  }

  isValidUsername(username) {
    return typeof username === "string" && username.length > 0 && username.length <= 12;
  }

  sessionToken(token) {
    return typeof token === "string" && token.length >= 16 ? token : crypto.randomUUID();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const id = env.POKER_ROOM.idFromName("global-lobby");
      return env.POKER_ROOM.get(id).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
