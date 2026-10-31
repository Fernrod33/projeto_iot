# API + painel da comanda

Recebe o resumo que o ESP32 manda quando uma pulseira é fechada (ver
`enviarResumo()` no `sketch.ino`), recalcula o total a partir dos itens — não
confia só no valor que o terminal mandou, é uma checagem simples de
integridade — e mostra tudo num painel web que atualiza sozinho.

Não usa nenhuma biblioteca externa (só módulos nativos do Node), então não
precisa de `npm install` para rodar.

## Como rodar

```
cd api
node server.js
```

Por padrão sobe em `http://localhost:3000`:

- Painel: `http://localhost:3000/`
- API (o ESP32 manda os dados aqui): `POST http://localhost:3000/api/comandas`
- API (lista o que já chegou): `GET http://localhost:3000/api/comandas`

Os dados ficam guardados em `comandas.json` (as 200 comandas mais recentes) —
esse arquivo não entra no Git (está no `.gitignore`), porque é dado de
execução, não código.

## Testando sem o Wokwi (com curl)

```
curl -X POST http://localhost:3000/api/comandas \
  -H "Content-Type: application/json" \
  -d '{"tag_uid":"01020304","itens":[{"item":"Refrigerante","valor":8.00},{"item":"Cerveja","valor":12.00}],"total":20.00}'
```

Depois abra `http://localhost:3000/` no navegador para ver a comanda
aparecer no painel.

## Fazendo o ESP32 do Wokwi alcançar esta API de verdade

O simulador do Wokwi usa a rede Wi-Fi `Wokwi-GUEST`, que só tem saída para a
internet pública — ele não alcança o `localhost` do seu computador. Pra
testar de ponta a ponta (terminal → internet → API), esta API precisa estar
em um endereço público. Duas formas simples:

1. **Tunelzinho temporário (mais rápido para testar agora):** instale o
   [ngrok](https://ngrok.com/) (tem plano gratuito), rode `node server.js`
   numa aba e `ngrok http 3000` em outra. O ngrok te dá uma URL pública tipo
   `https://alguma-coisa.ngrok-free.app` — cole essa URL + `/api/comandas`
   na constante `API_URL` do `sketch.ino` no Wokwi.
2. **Hospedar de verdade (melhor para a entrega final):** subir este
   `api/` num serviço gratuito (Render, Railway, Fly.io, etc. — qualquer um
   que rode Node.js) e usar a URL fixa que ele te dá.

Em qualquer um dos dois casos, troque no `sketch.ino`:

```cpp
const char* API_URL = "http://SEU-SERVIDOR-AQUI/api/comandas"; // <- aqui
```

pela URL real (com `/api/comandas` no final), e recarregue a simulação.

## Resposta da API

`POST /api/comandas` responde:

```json
{ "ok": true, "id": "mvv4h18nmuz1", "total": 20 }
```

`GET /api/comandas` responde com a lista (mais recente primeiro), cada item
no formato:

```json
{
  "id": "mvv4h18nmuz1",
  "tag_uid": "01020304",
  "itens": [{ "item": "Refrigerante", "valor": 8 }, { "item": "Cerveja", "valor": 12 }],
  "total": 20,
  "total_informado_pelo_terminal": 20,
  "recebido_em": "2026-10-30T15:23:47.207Z"
}
```

`total` é sempre recalculado pelo servidor somando os itens; 
`total_informado_pelo_terminal` guarda o valor que o ESP32 mandou, só para
comparação (útil para o relatório, se quiserem comentar sobre integridade
dos dados — um dos pontos do adicional de segurança do edital).
