/*
 * API + painel da pulseira-comanda
 * Trabalho final de IoT
 *
 * Recebe, por HTTP POST, o resumo que o ESP32 manda quando uma comanda e'
 * fechada (ver enviarResumo() no sketch.ino), recalcula o total a pagar a
 * partir dos itens (nunca confia so no total que o terminal mandou - e' uma
 * checagem simples de integridade) e guarda o resultado para o painel web
 * mostrar.
 *
 * Sem dependencias externas (so os modulos nativos do Node) - nao precisa de
 * "npm install" para rodar.
 *
 * Como rodar:
 *   node server.js
 *   (ou: npm start)
 * Por padrao sobe em http://localhost:3000 - o painel fica em "/" e a API em
 * "/api/comandas". Veja o README.md desta pasta para como expor isso na
 * internet para o ESP32 do Wokwi conseguir mandar os dados de verdade.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTA = process.env.PORT || 3000;
const ARQUIVO_DADOS = path.join(__dirname, 'comandas.json');
const PASTA_PUBLICA = path.join(__dirname, 'public');

// ---------- "Banco de dados": um arquivo JSON simples ----------
function carregarComandas() {
  try {
    const conteudo = fs.readFileSync(ARQUIVO_DADOS, 'utf8');
    return JSON.parse(conteudo);
  } catch (erro) {
    return []; // arquivo nao existe ainda ou esta vazio - comeca do zero
  }
}

function salvarComandas(comandas) {
  fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(comandas, null, 2));
}

let comandas = carregarComandas();

// ---------- Recalcula o total a partir dos itens, nao confia no valor enviado ----------
function calcularTotal(itens) {
  return itens.reduce((soma, item) => {
    const valor = Number(item.valor);
    return soma + (Number.isFinite(valor) ? valor : 0);
  }, 0);
}

function enviarJson(res, status, dados) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(corpo),
  });
  res.end(corpo);
}

function lerCorpoJson(req, callback) {
  let bruto = '';
  req.on('data', (pedaco) => {
    bruto += pedaco;
    if (bruto.length > 1e6) req.destroy(); // protecao basica contra payload gigante
  });
  req.on('end', () => {
    try {
      callback(null, JSON.parse(bruto || '{}'));
    } catch (erro) {
      callback(erro, null);
    }
  });
}

// ---------- Serve os arquivos estaticos do painel (pasta public/) ----------
const TIPOS_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function servirArquivoEstatico(req, res) {
  let caminhoPedido = req.url === '/' ? '/index.html' : req.url;
  const caminhoArquivo = path.join(PASTA_PUBLICA, caminhoPedido);

  // nunca sair da pasta public/ (protecao contra path traversal)
  if (!caminhoArquivo.startsWith(PASTA_PUBLICA)) {
    res.writeHead(403);
    res.end('Acesso negado');
    return;
  }

  fs.readFile(caminhoArquivo, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nao encontrado');
      return;
    }
    const extensao = path.extname(caminhoArquivo);
    res.writeHead(200, { 'Content-Type': TIPOS_MIME[extensao] || 'application/octet-stream' });
    res.end(conteudo);
  });
}

// ---------- Rotas da API ----------
const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS basico (deixa o painel, se servido de outra origem, conseguir ler a API)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // POST /api/comandas - o ESP32 manda o resumo da comanda fechada aqui
  if (req.method === 'POST' && url.pathname === '/api/comandas') {
    lerCorpoJson(req, (erro, dados) => {
      if (erro) {
        enviarJson(res, 400, { ok: false, erro: 'JSON invalido' });
        return;
      }

      const { tag_uid, itens } = dados;
      if (!tag_uid || !Array.isArray(itens) || itens.length === 0) {
        enviarJson(res, 400, { ok: false, erro: 'Campos obrigatorios: tag_uid (texto) e itens (lista nao vazia)' });
        return;
      }

      const totalCalculado = calcularTotal(itens);
      const comanda = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        tag_uid: String(tag_uid),
        itens: itens.map((i) => ({ item: String(i.item || 'item desconhecido'), valor: Number(i.valor) || 0 })),
        total: Math.round(totalCalculado * 100) / 100,
        total_informado_pelo_terminal: Number(dados.total) || null,
        recebido_em: new Date().toISOString(),
      };

      comandas.unshift(comanda); // mais recente primeiro
      comandas = comandas.slice(0, 200); // guarda so as 200 ultimas, pra nao crescer sem limite
      salvarComandas(comandas);

      console.log(`Comanda recebida: tag ${comanda.tag_uid} - total R$ ${comanda.total.toFixed(2)}`);
      enviarJson(res, 201, { ok: true, id: comanda.id, total: comanda.total });
    });
    return;
  }

  // GET /api/comandas - lista as comandas recebidas (o painel consome esta rota)
  if (req.method === 'GET' && url.pathname === '/api/comandas') {
    enviarJson(res, 200, comandas);
    return;
  }

  // GET /api/comandas/:id - uma comanda especifica
  if (req.method === 'GET' && url.pathname.startsWith('/api/comandas/')) {
    const id = url.pathname.split('/').pop();
    const comanda = comandas.find((c) => c.id === id);
    if (!comanda) {
      enviarJson(res, 404, { ok: false, erro: 'Comanda nao encontrada' });
      return;
    }
    enviarJson(res, 200, comanda);
    return;
  }

  // qualquer outra rota: tenta servir um arquivo estatico do painel
  servirArquivoEstatico(req, res);
});

servidor.listen(PORTA, () => {
  console.log(`API da comanda rodando em http://localhost:${PORTA}`);
  console.log(`Painel:        http://localhost:${PORTA}/`);
  console.log(`API (receber): POST http://localhost:${PORTA}/api/comandas`);
  console.log(`API (listar):  GET  http://localhost:${PORTA}/api/comandas`);
});
