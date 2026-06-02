<script>
  import { onMount } from 'svelte';
  import { createGameSocket } from './socket.js';

  let socket;
  let mode = 'lobby';
  let hostName = '';
  let joinName = '';
  let joinCode = '';
  let activeCode = '';
  let room = null;
  let joinedRoom = null;
  let hand = null;
  let table = null;
  let possibleMoves = {};
  let betAmount = 2;
  let raiseAmount = 2;
  let raiseBounds = { min: 0, max: 100 };
  let notice = '';
  let locale = 'en';

  const localeStorageKey = 'distributed-texasholdem-locale';
  const messages = {
    en: {
      title: "Distributed Texas Hold 'Em",
      intro: 'Host a table, share the code, and play a live hand with friends.',
      hostTable: 'Host Table',
      joinTable: 'Join Table',
      name: 'Name',
      code: 'Code',
      hostGame: 'Host Game',
      joinGame: 'Join Game',
      exit: 'Exit',
      table: 'Table',
      fullTable: 'This table is full. Maximum is 11 players.',
      waitingTwo: 'Waiting for at least two players.',
      startGame: 'Start Game',
      gameName: "Texas Hold 'Em",
      winners: 'Winner(s)',
      takes: 'takes',
      round: 'Round',
      topBet: 'Top bet',
      pot: 'Pot',
      player: 'Player',
      myTurn: 'My Turn',
      noCommunityCards: 'No community cards yet',
      actions: 'Actions',
      fold: 'Fold',
      check: 'Check',
      bet: 'Bet',
      call: 'Call',
      callAllIn: 'Call All-In',
      raise: 'Raise',
      startNextHand: 'Start Next Hand',
      waitingPlayer: 'Waiting for another player.',
      buyIn: 'buy-in',
      buyIns: 'buy-ins',
      connected: 'Connected',
      connectionLost: 'Connection lost. Reconnecting...',
      invalidGame: 'Error: invalid game.',
      yourTurn: 'Your turn',
      wonHand: 'You won the hand.',
      hostNameInvalid: 'Enter a valid name with 1-12 characters.',
      joinInvalid: 'Enter a valid name and room code.',
      reconnected: 'Reconnected.',
      disconnected: 'disconnected.',
      playerReconnected: 'reconnected.',
      exited: 'Exited table.',
      language: '中文',
    },
    zh: {
      title: '分布式德州扑克',
      intro: '创建牌桌、分享房间码，和朋友实时打一手德州扑克。',
      hostTable: '创建牌桌',
      joinTable: '加入牌桌',
      name: '名字',
      code: '房间码',
      hostGame: '创建游戏',
      joinGame: '加入游戏',
      exit: '退出',
      table: '牌桌',
      fullTable: '这个牌桌已满，最多 11 名玩家。',
      waitingTwo: '等待至少两名玩家。',
      startGame: '开始游戏',
      gameName: '德州扑克',
      winners: '赢家',
      takes: '赢得',
      round: '第',
      topBet: '最高下注',
      pot: '底池',
      player: '玩家',
      myTurn: '轮到我',
      noCommunityCards: '还没有公共牌',
      actions: '操作',
      fold: '弃牌',
      check: '过牌',
      bet: '下注',
      call: '跟注',
      callAllIn: '全下跟注',
      raise: '加注',
      startNextHand: '开始下一手',
      waitingPlayer: '等待其他玩家。',
      buyIn: '次买入',
      buyIns: '次买入',
      connected: '已连接',
      connectionLost: '连接断开，正在重连...',
      invalidGame: '错误：游戏无效。',
      yourTurn: '轮到你',
      wonHand: '你赢了这一手。',
      hostNameInvalid: '请输入 1-12 个字符的有效名字。',
      joinInvalid: '请输入有效名字和房间码。',
      reconnected: '已重新连接。',
      disconnected: '已断线。',
      playerReconnected: '已重连。',
      exited: '已退出牌桌。',
      language: 'English',
    },
  };

  const termMap = {
    zh: {
      'Pre-Flop': '翻牌前',
      Flop: '翻牌圈',
      Turn: '转牌圈',
      River: '河牌圈',
      Error: '错误',
      'Their Turn': '行动中',
      Fold: '弃牌',
      Check: '过牌',
      'Big Blind': '大盲',
      'Small Blind': '小盲',
      'High Card': '高牌',
      Pair: '一对',
      'Two Pair': '两对',
      'Three of a Kind': '三条',
      Straight: '顺子',
      Flush: '同花',
      'Full House': '葫芦',
      'Four of a Kind': '四条',
      'Straight Flush': '同花顺',
      'Royal Flush': '皇家同花顺',
    },
  };

  const redSuits = new Set(['♥', '♦']);

  $: copy = messages[locale];

  onMount(() => {
    locale = window.localStorage.getItem(localeStorageKey) || 'en';
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    socket = createGameSocket();
    socket.on('connected', () => setNotice(copy.connected));
    socket.on('connectionLost', () => setNotice(copy.connectionLost));
    socket.on('errorMessage', (data) => setNotice(data.message));
    socket.on('resumeFailed', (data) => setNotice(data.message));
    socket.on('resumed', handleResumed);
    socket.on('exited', handleExited);
    socket.on('playerDisconnected', (data) => setNotice(`${data.player} ${copy.disconnected}`));
    socket.on('playerReconnected', (data) => setNotice(`${data.player} ${copy.playerReconnected}`));
    socket.on('hostRoom', handleHostRoom);
    socket.on('hostRoomUpdate', (data) => {
      if (room) room = { ...room, players: data.players };
    });
    socket.on('joinRoom', handleJoinRoom);
    socket.on('joinRoomUpdate', (data) => {
      joinedRoom = { host: data.host ?? joinedRoom?.host ?? 'New host', players: data.players };
      if (data.code) room = { code: data.code, players: data.players };
    });
    socket.on('gameBegin', (data) => {
      if (!data) setNotice(copy.invalidGame);
      else mode = 'game';
    });
    socket.on('dealt', (data) => {
      hand = data;
      mode = 'game';
    });
    socket.on('rerender', (data) => {
      table = data;
      betAmount = Math.max(2, Math.min(data.myMoney, betAmount));
      if (data.myStatus === 'Their Turn') {
        setNotice(copy.yourTurn);
        socket.emit('evaluatePossibleMoves');
      }
    });
    socket.on('displayPossibleMoves', (data) => {
      possibleMoves = data;
    });
    socket.on('updateRaiseModal', (data) => {
      raiseBounds = { min: data.topBet, max: data.usernameMoney };
      raiseAmount = Math.min(data.usernameMoney, Math.max(data.topBet + 1, raiseAmount));
    });
    socket.on('reveal', (data) => {
      table = { ...table, reveal: data, roundInProgress: false };
      possibleMoves = {};
      if (String(data.winners).split(',').includes(data.username)) setNotice(copy.wonHand);
    });
    socket.on('endHand', (data) => {
      table = { ...table, endHand: data, roundInProgress: false };
      possibleMoves = {};
    });
  });

  const setNotice = (message) => {
    notice = message;
    setTimeout(() => {
      if (notice === message) notice = '';
    }, 3200);
  };

  const handleHostRoom = (data) => {
    if (!data) {
      setNotice(copy.hostNameInvalid);
      return;
    }
    activeCode = data.code ?? data.session?.code ?? activeCode;
    room = data;
    joinedRoom = null;
    mode = 'room';
  };

  const handleJoinRoom = (data) => {
    if (!data) {
      setNotice(copy.joinInvalid);
      return;
    }
    activeCode = data.session?.code ?? joinCode.trim() ?? activeCode;
    joinedRoom = data;
    room = null;
    mode = 'room';
  };

  const handleResumed = (data) => {
    hostName = data.username;
    joinName = data.username;
    joinCode = data.code;
    activeCode = data.code;

    if (data.roundStarted) {
      mode = 'game';
      return;
    }

    if (data.isHost) {
      room = { code: data.code, players: data.players };
      joinedRoom = null;
    } else {
      joinedRoom = { host: data.host, players: data.players };
      room = null;
    }
    mode = 'room';
    setNotice(copy.reconnected);
  };

  const resetGameState = () => {
    mode = 'lobby';
    activeCode = '';
    room = null;
    joinedRoom = null;
    hand = null;
    table = null;
    possibleMoves = {};
    betAmount = 2;
    raiseAmount = 2;
    raiseBounds = { min: 0, max: 100 };
  };

  const handleExited = () => {
    socket.clearSession();
    resetGameState();
    setNotice(copy.exited);
  };

  const hostGame = () => socket.emit('host', { username: hostName.trim() });
  const joinGame = () =>
    socket.emit('join', { username: joinName.trim(), code: joinCode.trim() });
  const startGame = () => socket.emit('startGame', { code: activeCode || room?.code || joinCode.trim() });
  const exitGame = () => {
    socket.clearSession();
    socket.emit('leave');
    resetGameState();
    setNotice(copy.exited);
  };
  const playNext = () => socket.emit('startNextRound');
  const move = (moveName, bet = moveName) => socket.emit('moveMade', { move: moveName, bet });
  const openRaise = () => socket.emit('raiseModalData');

  const currentPlayers = () => room?.players ?? joinedRoom?.players ?? [];
  const currentHost = () => joinedRoom?.host ?? hostName;
  const roomCode = () => activeCode || room?.code || joinedRoom?.session?.code || joinCode.trim();
  const canStart = () => roomCode() && currentPlayers().length > 1 && currentPlayers().length <= 11;
  const myMoney = () => table?.myMoney ?? 100;
  const active = () => table?.myStatus === 'Their Turn' && table?.roundInProgress;
  const actionDisabled = (moveName) => !active() || possibleMoves[moveName] !== 'yes';
  const betFor = (name) => {
    const current = table?.bets?.[table.bets.length - 1] ?? [];
    return current.find((entry) => entry.player === name)?.bet ?? 0;
  };
  const buyInsText = (buyIns) => {
    if (!buyIns) return '';
    return `${buyIns} ${buyIns === 1 ? copy.buyIn : copy.buyIns}`;
  };
  const translate = (value) => termMap[locale]?.[value] ?? value ?? '';
  const toggleLocale = () => {
    locale = locale === 'zh' ? 'en' : 'zh';
    window.localStorage.setItem(localeStorageKey, locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  };
</script>

<main>
  <button class="language-switch" type="button" on:click={toggleLocale}>{copy.language}</button>

  {#if notice}
    <div class="toast">{notice}</div>
  {/if}

  {#if mode !== 'game'}
    <section class="lobby">
      <div class="brand">
        <span class="mark">TH</span>
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
      </div>

      <div class="lobby-grid">
        <form class="panel" on:submit|preventDefault={hostGame}>
          <h2>{copy.hostTable}</h2>
          <label>
            {copy.name}
            <input maxlength="12" bind:value={hostName} autocomplete="nickname" />
          </label>
          <button type="submit">{copy.hostGame}</button>
        </form>

        <form class="panel" on:submit|preventDefault={joinGame}>
          <h2>{copy.joinTable}</h2>
          <label>
            {copy.name}
            <input maxlength="12" bind:value={joinName} autocomplete="nickname" />
          </label>
          <label>
            {copy.code}
            <input maxlength="4" inputmode="numeric" bind:value={joinCode} />
          </label>
          <button type="submit">{copy.joinGame}</button>
        </form>
      </div>
    </section>

    {#if mode === 'room'}
      <section class="room">
        <div>
          <p class="eyebrow">{copy.table}</p>
          <h2>{roomCode() ? `${copy.code} ${roomCode()}` : `${currentHost()} ${copy.table}`}</h2>
        </div>
        <div class="player-list">
          {#each currentPlayers() as player}
            <span>{player}</span>
          {/each}
        </div>
        {#if currentPlayers().length >= 11}
          <p class="warning">{copy.fullTable}</p>
        {/if}
        <button class="start" disabled={!canStart()} on:click={startGame}>{copy.startGame}</button>
        {#if !canStart()}
          <p class="waiting">{copy.waitingTwo}</p>
        {/if}
        <button class="secondary" type="button" on:click={exitGame}>{copy.exit}</button>
      </section>
    {/if}
  {:else}
    <section class="table-shell">
      <header class="table-header">
        <div>
          <p class="eyebrow">{copy.gameName}</p>
          <h1>
            {#if table?.reveal}
              {copy.winners}: {table.reveal.winners}
            {:else if table?.endHand}
              {table.endHand.winner} {copy.takes} ${table.endHand.pot}
            {:else}
              {copy.round} {table?.round ?? 1} · {translate(table?.stage ?? 'Pre-Flop')}
            {/if}
          </h1>
        </div>
        <div class="stats">
          <span>{copy.topBet} ${table?.topBet ?? 0}</span>
          <span>{copy.pot} ${table?.pot ?? 0}</span>
          <button class="secondary compact" type="button" on:click={exitGame}>{copy.exit}</button>
        </div>
      </header>

      <div class="game-grid">
        <section class:turn={active()} class="self-panel">
          <div class="panel-heading">
            <h2>{hand?.username ?? table?.username ?? copy.player}</h2>
            <span>${myMoney()}</span>
          </div>
          <p>{translate(table?.myBlind)} {active() ? copy.myTurn : translate(table?.myStatus)}</p>
          <div class="cards">
            {#each hand?.cards ?? [] as card}
              <div class:red={redSuits.has(card.suit)} class="card-face">{card.value} {card.suit}</div>
            {/each}
          </div>
        </section>

        <section class="board">
          <div class="cards community">
            {#each table?.community ?? [] as card}
              <div class:red={redSuits.has(card.suit)} class="card-face">{card.value} {card.suit}</div>
            {/each}
            {#if !table?.community?.length}
              <p>{copy.noCommunityCards}</p>
            {/if}
          </div>
        </section>

        <section class="actions">
          <h2>{copy.actions}</h2>
          {#if table?.roundInProgress}
            <button disabled={actionDisabled('fold')} on:click={() => move('fold')}>{copy.fold}</button>
            <button disabled={actionDisabled('check')} on:click={() => move('check')}>{copy.check}</button>
            <label>
              {copy.bet}
              <input type="range" min="2" max={myMoney()} bind:value={betAmount} disabled={!active()} />
              <span>${betAmount}</span>
            </label>
            <button disabled={actionDisabled('bet')} on:click={() => move('bet', Number(betAmount))}>{copy.bet}</button>
            <button disabled={!active() || possibleMoves.call == null || possibleMoves.call === 'no'} on:click={() => move('call')}>
              {possibleMoves.call === 'all-in' ? copy.callAllIn : `${copy.call} $${possibleMoves.call ?? 0}`}
            </button>
            <label>
              {copy.raise}
              <input
                type="range"
                min={raiseBounds.min}
                max={raiseBounds.max}
                bind:value={raiseAmount}
                on:focus={openRaise}
                disabled={!active()}
              />
              <span>${raiseAmount}</span>
            </label>
            <button disabled={actionDisabled('raise')} on:click={() => move('raise', Number(raiseAmount))}>
              {copy.raise}
            </button>
            {#if !active()}
              <p>{copy.waitingPlayer}</p>
            {/if}
          {:else if table?.roundInProgress === false}
            <button on:click={playNext}>{copy.startNextHand}</button>
          {:else}
            <p>{copy.waitingPlayer}</p>
          {/if}
        </section>
      </div>

      <section class="opponents">
        {#each table?.reveal?.cards ?? table?.endHand?.cards ?? table?.players ?? [] as player}
          <article class:folded={player.folded || player.text === 'Fold'} class:turn={player.status === 'Their Turn'} class="opponent">
            <div class="panel-heading">
              <h3>{player.username}</h3>
              <span>${player.money}</span>
            </div>
            <p>{translate(player.hand ?? player.endHand ?? player.status ?? player.text)}</p>
            <p>{translate(player.blind)} {buyInsText(player.buyIns)}</p>
            <p>{copy.bet}: ${betFor(player.username)}</p>
            <div class="cards small">
              {#if player.cards}
                {#each player.cards as card}
                  <div class:red={redSuits.has(card.suit)} class="card-face">{card.value} {card.suit}</div>
                {/each}
              {:else}
                <div class="card-back"></div>
                <div class="card-back"></div>
              {/if}
            </div>
          </article>
        {/each}
      </section>
    </section>
  {/if}
</main>
