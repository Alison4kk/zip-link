
import express from "express";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import fs from "fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// AWS Clients
const oDynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const oDocClient = DynamoDBDocumentClient.from(oDynamoClient);

const oS3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Variáveis fixas
const DYNAMO_TABLE = "links";

let nRequestCount = 0;
let aLogBuffer = [];

async function salvarLogsNoS3(logs) {
  const nomeArquivo = `logs-${Date.now()}.json`;
  const comando = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: nomeArquivo,
    Body: JSON.stringify(logs, null, 2),
    ContentType: "application/json",
  });

  try {
    await oS3Client.send(comando);
    console.log(`✔ Logs enviados para o S3 como ${nomeArquivo}`);
  } catch (error) {
    console.error("❌ Erro ao salvar logs no S3:", error);
  }
}

// Funções auxiliares
async function registerMessage(sTableName, oContent) {
  if (!oContent.id) {
    oContent.id = uuidv4();
  }
  const oCommand = new PutCommand({
    TableName: sTableName,
    Item: oContent,
  });
  await oDocClient.send(oCommand);
}

app.use((req, res, next) => {
  const oLog = {
    method: req.method,
    url: req.originalUrl,
    body: req.body,
    timestamp: new Date().toISOString(),
  };

  aLogBuffer.push(oLog);
  if (aLogBuffer.length > 3) aLogBuffer.shift();

  nRequestCount++;
  if (nRequestCount >= 10) {
    salvarLogsNoS3([...aLogBuffer]);
    nRequestCount = 0;
  }

  next();
});

// Rotas
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.post("/api/criar", async (req, res) => {
  let { url } = req.body;
  const hash = uuidv4().slice(0, 6);

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `http://${url}`;
  }

  await registerMessage(DYNAMO_TABLE, {
    hash,
    url,
    timestamp: Date.now(), // novo campo
  });

  res.json({ curto: `http://${req.headers.host}/${hash}` });
});


app.get("/:hash", async (req, res) => {
  const { hash } = req.params;

  const oCommand = new GetCommand({
    TableName: DYNAMO_TABLE,
    Key: { hash },
  });

  const result = await oDocClient.send(oCommand);
  const link = result.Item?.url;

  if (!link) return res.status(404).send("Link não encontrado");

  // Lê o HTML da página e substitui o placeholder {{URL}} pela URL real
  const html = await fs.readFile(path.join(__dirname, "public", "redirecionando.html"), "utf8");
  const renderedHtml = html.replace("{{URL}}", link);

  res.send(renderedHtml);
});

app.get("/api/ultimos", async (req, res) => {
  try {
    const comando = new ScanCommand({
      TableName: DYNAMO_TABLE,
      Limit: 50,
    });

    const result = await oDocClient.send(comando);
    const aLinksOrdenados = (result.Items || [])
      .filter(item => item.timestamp)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
      .map(({ hash, url, timestamp }) => (`http://${req.headers.host}/${hash.S}`));

    res.json(aLinksOrdenados);
  } catch (error) {
    console.error("Erro ao buscar últimos links:", error);
    res.status(500).json({ erro: "Erro interno do servidor" });
  }
});

app.get("/api/aleatorio", async (req, res) => {
  try {
    const comando = new ScanCommand({
      TableName: DYNAMO_TABLE,
      Limit: 50,
    });

    const result = await oDocClient.send(comando);
    const aItens = result.Items || [];

    if (aItens.length === 0) {
      return res.status(404).send("Nenhum link disponível.");
    }

    const aleatorio = aItens[Math.floor(Math.random() * aItens.length)];
    const hash = aleatorio.hash?.S || aleatorio.hash;
    const url = `http://${req.headers.host}/${hash}`;

    res.redirect(url);
  } catch (error) {
    console.error("Erro ao redirecionar para link aleatório:", error);
    res.status(500).send("Erro ao redirecionar para link aleatório.");
  }
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => console.log("Rodando na porta", PORT));
