const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");
const {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
} = require("@discordjs/voice");
const prism = require("prism-media");

// ── 상수 ───────────────────────────────────────────────────────────────
// Discord 음성은 48kHz·스테레오·16bit PCM. 1초당 48000 * 2채널 * 2바이트.
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE; // 192000
const FRAME_BYTES = CHANNELS * BYTES_PER_SAMPLE; // 4 (한 샘플프레임)
const RECORDINGS_DIR = "recordings";
const AUDIO_EXT = new Set([".flac", ".wav", ".mp3"]);

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN 이 .env 에 없습니다.");
  process.exit(1);
}

// ── 전역 세션 상태 (프로토타입: 동시 1세션만) ──────────────────────────
// session = { guild, channelId, startMs, users: Map<userId, UserTrack> }
let session = null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// 파일명 안전화: 한글·영문·숫자만 남기고 나머지는 _. transcribe.js 는
// "<index>-<이름>.flac" 에서 첫 '-' 뒤를 화자명으로 파싱하므로 '-' 는 제거.
function sanitizeName(name) {
  return (
    name
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "user"
  );
}

// 새 세션 시작 전, recordings/ 의 기존 오디오를 백업 폴더로 이동(삭제 X).
// 이렇게 해야 이번 회의 트랙만 transcribe 대상이 된다.
function archiveExistingRecordings() {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    return null;
  }
  const audio = fs
    .readdirSync(RECORDINGS_DIR)
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
  if (audio.length === 0) return null;

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const archiveDir = path.join(RECORDINGS_DIR, `_archive_${ts}`);
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const f of audio) {
    fs.renameSync(path.join(RECORDINGS_DIR, f), path.join(archiveDir, f));
  }
  return { archiveDir, count: audio.length };
}

// 한 화자의 트랙: opus 스트림 → PCM 디코드 → 침묵 패딩 → ffmpeg(FLAC) stdin.
function startUserTrack(userId, displayName) {
  const index = session.users.size + 1;
  const safe = sanitizeName(displayName);
  const filePath = path.join(RECORDINGS_DIR, `${index}-${safe}.flac`);

  // ffmpeg: raw PCM(s16le 48k stereo) 을 받아 FLAC 로 인코딩.
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-f", "s16le",
      "-ar", String(SAMPLE_RATE),
      "-ac", String(CHANNELS),
      "-i", "pipe:0",
      "-y", filePath,
    ],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  ffmpeg.on("error", (e) =>
    console.error(`  ⚠️ [${safe}] ffmpeg 오류: ${e.message}`),
  );

  const connection = getVoiceConnection(session.guild.id);
  const opusStream = connection.receiver.subscribe(userId, {
    // Manual: 화자가 침묵해도 스트림을 닫지 않고, /record stop 까지 유지.
    end: { behavior: EndBehaviorType.Manual },
  });
  const decoder = new prism.opus.Decoder({
    rate: SAMPLE_RATE,
    channels: CHANNELS,
    frameSize: 960,
  });

  const track = { index, safe, filePath, ffmpeg, opusStream, decoder, pcmWritten: 0 };

  decoder.on("data", (chunk) => {
    // 도착 시각 기준으로 있어야 할 바이트 위치를 계산해, 비어 있는
    // 침묵 구간을 0 으로 채운다 → 모든 트랙이 벽시계에 정렬된다.
    const elapsedMs = Date.now() - session.startMs;
    let target = Math.floor((elapsedMs / 1000) * BYTES_PER_SECOND);
    target -= target % FRAME_BYTES; // 프레임 경계 정렬
    if (target > track.pcmWritten) {
      const silence = Buffer.alloc(target - track.pcmWritten);
      ffmpeg.stdin.write(silence);
      track.pcmWritten = target;
    }
    ffmpeg.stdin.write(chunk);
    track.pcmWritten += chunk.length;
  });

  // Discord 음성 수신은 화자 발화 경계·패킷 유실 등에서 간헐적으로 깨진
  // Opus 패킷을 흘려보낸다. 네이티브 디코더는 이때 'error' 를 throw 하는데,
  // 리스너가 없으면 Node 가 그대로 프로세스를 죽인다. 해당 패킷만 버리고
  // 트랙·세션은 살려서 녹음이 끊기지 않게 한다.
  decoder.on("error", (e) =>
    console.warn(`  ⚠️ [${safe}] opus 디코드 스킵: ${e.message}`),
  );
  opusStream.on("error", (e) =>
    console.warn(`  ⚠️ [${safe}] opus 스트림 오류: ${e.message}`),
  );

  // pipe 의 기본 동작은 소스 종료 시 디코더를 end 시키지만, 에러는
  // 전파하지 않으므로 위에서 양쪽에 직접 핸들러를 달았다.
  opusStream.pipe(decoder);
  session.users.set(userId, track);
  console.log(`  🎙️  트랙 시작: ${filePath}`);
}

// 모든 트랙을 닫고 FLAC 파일이 완전히 기록될 때까지 대기.
function finalizeTracks() {
  const tracks = [...session.users.values()];
  return Promise.all(
    tracks.map(
      (t) =>
        new Promise((resolve) => {
          t.opusStream.destroy();
          t.decoder.end();
          t.ffmpeg.stdin.end();
          t.ffmpeg.on("close", resolve);
          t.ffmpeg.on("error", resolve);
        }),
    ),
  );
}

async function handleStart(interaction) {
  if (session) {
    return interaction.reply({
      content: "⚠️ 이미 녹음 중입니다. 먼저 `/record stop` 으로 종료하세요.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({
      content: "❌ 먼저 음성 채널에 입장한 뒤 `/record start` 를 실행하세요.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const archived = archiveExistingRecordings();

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false, // ⭐ 수신하려면 반드시 false (귀를 닫으면 오디오가 안 옴)
    selfMute: true, // 봇은 송신 안 함
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (e) {
    connection.destroy();
    return interaction.editReply(`❌ 음성 채널 연결 실패: ${e.message}`);
  }

  session = {
    guild: interaction.guild,
    channelId: voiceChannel.id,
    startMs: Date.now(),
    users: new Map(),
  };

  // 화자가 말을 시작하면 해당 유저 트랙을 1회만 생성(이후 침묵·재발화는
  // Manual 구독이 계속 처리). 봇 자신·다른 봇은 제외.
  connection.receiver.speaking.on("start", async (userId) => {
    if (session.users.has(userId)) return;
    try {
      const member = await session.guild.members.fetch(userId);
      if (member.user.bot) return;
      startUserTrack(userId, member.displayName || member.user.username);
    } catch (e) {
      console.error(`  ⚠️ 멤버 조회 실패(${userId}): ${e.message}`);
    }
  });

  const archMsg = archived
    ? `\n🗂️ 기존 오디오 ${archived.count}개를 \`${archived.archiveDir}\` 로 백업했습니다.`
    : "";
  console.log(`🔴 녹음 시작 — 채널 "${voiceChannel.name}"`);
  await interaction.editReply(
    `🔴 **녹음 시작** — \`${voiceChannel.name}\`\n말하는 사람부터 트랙이 자동 생성됩니다. 종료하려면 \`/record stop\`.${archMsg}`,
  );
}

async function handleStop(interaction) {
  if (!session) {
    return interaction.reply({
      content: "⚠️ 진행 중인 녹음이 없습니다.",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();
  const userCount = session.users.size;
  console.log(`⏹️  녹음 종료 — 트랙 ${userCount}개 마무리 중...`);

  await finalizeTracks();

  const connection = getVoiceConnection(session.guild.id);
  if (connection) connection.destroy();
  session = null;

  if (userCount === 0) {
    return interaction.editReply(
      "⏹️ 녹음을 종료했지만 감지된 발화가 없어 트랙이 없습니다. 파이프라인을 실행하지 않습니다.",
    );
  }

  await interaction.editReply(
    `⏹️ **녹음 종료** — 트랙 ${userCount}개 저장 완료.\n🚀 회의록 파이프라인(\`npm run start\`)을 실행합니다... 완료되면 Discord/Notion/Wiki 에 올라갑니다.`,
  );

  // 전사 → 요약 → 업로드 파이프라인 자동 실행.
  const pipeline = spawn("npm", ["run", "start"], { stdio: "inherit" });
  pipeline.on("close", (code) => {
    console.log(
      code === 0
        ? "✅ 파이프라인 완료."
        : `❌ 파이프라인이 코드 ${code} 로 종료됨.`,
    );
  });
}

client.once("clientReady", async () => {
  console.log(`✅ 봇 로그인: ${client.user.tag}`);

  // 길드 슬래시 커맨드는 즉시 반영(글로벌은 최대 1시간). 들어가 있는 모든
  // 서버에 /record start · /record stop 등록.
  const command = new SlashCommandBuilder()
    .setName("record")
    .setDescription("회의 녹음 제어")
    .addSubcommand((s) =>
      s.setName("start").setDescription("음성 채널 녹음 시작"),
    )
    .addSubcommand((s) =>
      s.setName("stop").setDescription("녹음 종료 후 회의록 파이프라인 실행"),
    )
    .toJSON();

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set([command]);
      console.log(`  ↳ 커맨드 등록: ${guild.name}`);
    } catch (e) {
      console.error(`  ⚠️ 커맨드 등록 실패(${guild.name}): ${e.message}`);
    }
  }
  console.log("🟢 준비 완료. 음성 채널에서 /record start 를 실행하세요.");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "record")
    return;
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === "start") await handleStart(interaction);
    else if (sub === "stop") await handleStop(interaction);
  } catch (e) {
    console.error("인터랙션 처리 오류:", e);
    const msg = `❌ 오류: ${e.message}`;
    if (interaction.deferred || interaction.replied)
      interaction.editReply(msg).catch(() => {});
    else
      interaction
        .reply({ content: msg, flags: MessageFlags.Ephemeral })
        .catch(() => {});
  }
});

client.login(TOKEN);
