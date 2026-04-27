# repairdao-contracts

Repositório de contratos Solidity do RepairDAO, com Hardhat, testes e scripts de deploy.

Neste repositório fica a camada on-chain do projeto, responsável por token, depósito, reputação, badges, ordens de serviço, disputas e governança.

## Requisitos

- Git
- Node.js 20 ou superior
- Yarn 1.x

## Clone

```bash
git clone https://github.com/georgines/repairdao-contracts.git
```

Para integração automática com o app, mantenha `repairdao` como pasta irmã:

```text
workspace/
|- repairdao/
|- repairdao-contracts/
```

Se for usar a integração com o app, clone também o repositório `repairdao`:

```bash
git clone https://github.com/georgines/repairdao.git
```

## Configuração

1. Duplique `.env.example` como `.env`.
2. Para rede local, o `.env.example` já traz a chave padrão do Hardhat.
3. Para Sepolia, preencha `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY` e, se necessário, ajuste `SEPOLIA_PRICE_FEED_ADDRESS`.

Para configurar `SEPOLIA_RPC_URL`, escolha uma destas opções:

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/SUA_CHAVE_AQUI
```

Use esse formato no `.env` quando tiver uma chave própria.

Se preferir não usar chave em desenvolvimento, use um endpoint público:

```env
SEPOLIA_RPC_URL=https://rpc.sepolia.org
```

ou

```env
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

As RPCs públicas costumam ser suficientes para desenvolvimento e testes, mas tendem a ter mais instabilidade e limite menor do que provedores com chave própria.

## Instalação

```bash
yarn install
```

## Compilar e testar

```bash
yarn run compile
yarn run test
```

## Subir rede local

Terminal 1:

```bash
yarn run node
```

Terminal 2:

```bash
yarn run deploy:local
```

Se a pasta irmã `repairdao` existir, o deploy grava os endereços em `../repairdao/src/contracts/deploy/local.json`.

## Deploy em Sepolia

```bash
yarn run deploy:sepolia
```
