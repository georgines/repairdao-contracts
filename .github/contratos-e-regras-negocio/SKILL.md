---
name: contratos-e-regras-negocio
description: >
  Skill para implementar, corrigir e estender os contratos Solidity do RepairDAO.
  Use sempre que for criar novos contratos, corrigir bugs, adicionar funções ou
  escrever testes para o protocolo RepairDAO.
---

# RepairDAO — Skill de Contratos Solidity

## Visão geral

RepairDAO é um protocolo descentralizado de certificação e pagamento para técnicos
de reparo. A reputação é construída on-chain, os
pagamentos são protegidos por escrow e a comunidade governa as regras via DAO.

---

## Stack técnica obrigatória

- Solidity `^0.8.20`
- OpenZeppelin v5: `ERC20`, `ERC721`, `Ownable`, `ReentrancyGuard`
- Chainlink `AggregatorV3Interface` para preço ETH/USD
- Hardhat 2.x com TypeScript
- ethers.js v6

---

## Arquitetura — 6 Contratos

```
RepairToken        → ERC-20, moeda nativa + compra com ETH
RepairBadge        → ERC-721, NFT soulbound de nível de reputação
RepairDeposit      → Depósito, rendimentos e slash
RepairReputation   → Níveis, pontos e avaliações
RepairEscrow       → Pagamento seguro + disputa com votação
RepairGovernance   → DAO simplificada
```

### Dependências entre contratos (ordem de deploy)

```
1. RepairToken
2. RepairBadge
3. MockPriceFeed (apenas rede local para testes)
4. RepairDeposit  (depende de: Token, Badge, PriceFeed)
5. RepairReputation (depende de: Badge, Deposit)
6. RepairEscrow   (depende de: Token, Deposit, Reputation)
7. RepairGovernance (depende de: Token, Deposit)
```

### Autorizações pós-deploy obrigatórias

```
repairBadge.authorizeContract(reputationAddress)
repairReputation.authorizeContract(escrowAddress)
repairDeposit.authorizeContract(escrowAddress)
repairDeposit.authorizeContract(reputationAddress)
```

---

## Regras de Negócio — NUNCA viole estas regras

### Usuário

- Usuário só opera no sistema se tiver depósito ativo (`isActive == true`)
- Usuário pode ser cliente ou técnico, mas não ambos na mesma ordem
- Ao depositar → conta ativa, NFT nível 1 Bronze emitido, começa a acumular rendimentos
- Sacar rendimentos (`withdrawRewards`) → conta continua ativa, NFT mantido
- Sacar depósito (`withdrawDeposit`) → conta desativada, NFT queimado, nível zerado
- Ao depositar novamente → começa do nível 1

### Depósito e Rendimentos

- Depósito mínimo: 100 RPT
- Rendimento acumula por tempo depositado × taxa do nível atual
- Taxa ajustada pelo preço ETH/USD via Chainlink
- Taxas por nível (basis points — 1% = 100bp):
  - Nível 1 Bronze  → 1100 (11% ao ano)
  - Nível 2 Prata   → 1200 (12% ao ano)
  - Nível 3 Ouro    → 1300 (13% ao ano)
  - Nível 4 Platina → 1400 (14% ao ano)
  - Nível 5 Elite   → 1500 (15% ao ano)

### NFT Badge — Soulbound

- NFT emitido automaticamente ao depositar (nível 1 Bronze)
- NFT é intransferível — bloquear em `_update`, `approve` e `setApprovalForAll`
- Quando nível muda → queima NFT antigo → emite novo com nível atual
- Quando depósito sacado → NFT queimado

### Reputação e Níveis

- Todo usuário começa no nível 1 ao depositar
- Pontos necessários para subir de nível: 10 por nível
  - Nível 1: 0–9 pontos
  - Nível 2: 10–19 pontos
  - Nível 3: 20–29 pontos
  - Nível 4: 30–39 pontos
  - Nível 5: 40+ pontos
- Avaliação positiva (4–5 estrelas) → +2 pontos
- Avaliação negativa (1–2 estrelas) → -3 pontos
- Penalidade por fraude/disputa perdida → -5 pontos
- Recompensa por voto vencedor → +2 pontos
- Cada usuário avalia o outro só uma vez por serviço (serviceId)
- Técnico avalia cliente e cliente avalia técnico

### Escrow — Fluxo do Serviço

```
Estado Open      → cliente cria ordem (createOrder)
Estado Budgeted  → técnico envia orçamento (submitBudget)
Estado InProgress→ cliente aceita e trava pagamento (acceptBudget)
Estado Completed → técnico marca como concluído (completeOrder)
                 → cliente confirma e pagamento liberado (confirmCompletion)
                 → ambos se avaliam (rateUser)
Estado Disputed  → qualquer parte abre disputa (openDispute)
Estado Resolved  → disputa resolvida por votação (resolveDispute)
```

- Só cliente com depósito ativo pode criar ordens
- Só técnico com depósito ativo pode enviar orçamento
- Cliente não pode ser técnico da própria ordem
- Pagamento travado no contrato ao aceitar orçamento
- Avaliação disponível em Completed ou Resolved

### Disputa

- Qualquer parte (cliente ou técnico) pode abrir disputa
- Ambos submetem evidências durante o período de votação
- Partes envolvidas NÃO podem votar
- Poder de voto = saldo de tokens RPT do votante
- Prazo de votação: 1 dia
- Empate → vence quem abriu a disputa
- Resultado:
  - Vencedor: recebe pagamento + slash do perdedor
  - Perdedor: perde pagamento + slash de 20% do depósito + penalidade de reputação
  - Votante vencedor: recompensa de reputação
  - Votante perdedor: slash de 5% do depósito + penalidade de reputação

### Governança

- Só usuários com depósito ativo podem criar propostas
- Poder de voto = saldo de tokens RPT
- Duração: 1 a 30 dias
- Quórum mínimo: 1000 RPT
- Proposta aprovada se: quórum atingido E votos a favor > votos contra

---

## Padrões obrigatórios em todos os contratos

### Segurança

```solidity
// Sempre em funções de transferência de tokens
nonReentrant

// Sempre em funções administrativas
onlyOwner

// Para contratos autorizados
onlyAuthorized
```

### Controle de acesso

```solidity
mapping(address => bool) public authorizedContracts;

function authorizeContract(address contractAddress) external onlyOwner {
    authorizedContracts[contractAddress] = true;
}

modifier onlyAuthorized() {
    require(
        authorizedContracts[msg.sender] || msg.sender == owner(),
        "Not authorized"
    );
    _;
}
```

### Eventos obrigatórios

Todo contrato deve emitir eventos para todas as ações importantes.
Eventos facilitam indexação e auditoria on-chain.

```solidity
// Padrão de evento
event NomeDoEvento(address indexed user, uint256 valor);
emit NomeDoEvento(msg.sender, valor);
```

### Structs e Mappings

```solidity
// Sempre usar struct para agrupar dados relacionados
struct NomeDoStruct {
    uint256 campo1;
    address campo2;
    bool campo3;
}

// Sempre usar mapping para dados por endereço
mapping(address => NomeDoStruct) public dados;
```

### Requires com mensagens claras

```solidity
// Sempre incluir mensagem descritiva
require(condição, "Mensagem clara em inglês");
```

---

## Interfaces entre contratos

### IRepairBadge (usado por RepairReputation e RepairDeposit)

```solidity
interface IRepairBadge {
    function mintBadge(address user) external;
    function burnBadge(address user) external;
    function updateBadge(address user, uint8 newLevel) external;
    function getBadgeLevel(address user) external view returns (uint8);
    function hasBadge(address user) external view returns (bool);
}
```

### IRepairDeposit (usado por RepairReputation e RepairEscrow)

```solidity
interface IRepairDeposit {
    function isActive(address user) external view returns (bool);
    function updateRate(address user, uint256 newRate) external;
    function slash(address user, uint256 percent) external;
}
```

### IRepairReputation (usado por RepairEscrow)

```solidity
interface IRepairReputation {
    function rate(address rated, uint8 rating, uint256 serviceId) external;
    function penalize(address user) external;
    function reward(address user) external;
    function getLevel(address user) external view returns (uint8);
    function registerUser(address user) external;
}
```

### IRepairDepositGov (usado por RepairGovernance)

```solidity
interface IRepairDepositGov {
    function isActive(address user) external view returns (bool);
}
```

### AggregatorV3Interface (Chainlink)

```solidity
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}
```

---

## MockPriceFeed — apenas para rede local

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPriceFeed {
    int256 private _price;

    constructor(int256 initialPrice) {
        _price = initialPrice;
    }

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (1, _price, block.timestamp, block.timestamp, 1);
    }

    function setPrice(int256 newPrice) external {
        _price = newPrice;
    }
}
```

Preço inicial padrão para testes: `200000000000` (= $2000.00 com 8 decimais)

---

### Variáveis de ambiente

```
arquivo .env (não comitar este arquivo!)
```

---

## Scripts yarn

```bash
yarn compile          # Compilar contratos
yarn deploy:local     # Deploy na rede local (localhost)
yarn deploy:sepolia   # Deploy na Sepolia
yarn node             # Iniciar nó local Hardhat (ja está rodando em um terminal separado)
yarn test             # Rodar todos os testes
```

---

## Checklist ao implementar qualquer contrato

- [ ] Solidity `^0.8.20`
- [ ] Importar OpenZeppelin correto
- [ ] `nonReentrant` em todas as funções de transferência
- [ ] `onlyOwner` em funções administrativas
- [ ] `onlyAuthorized` para contratos externos
- [ ] `mapping(address => bool) authorizedContracts`
- [ ] `authorizeContract()` disponível
- [ ] Eventos para todas as ações
- [ ] `require` com mensagens em inglês
- [ ] `struct` para dados agrupados
- [ ] `mapping` para dados por endereço
- [ ] Comentários em portugues
- [ ] Seguir fluxo e regras de negócio sem exceções
- [ ] Conectar contratos via endereços no constructor

---

## Checklist ao escrever testes

- [ ] Um arquivo de teste por contrato
- [ ] Testar logica de negócios tambem, nao apenas funcoes
- [ ] `beforeEach` para deploy e setup
- [ ] Testar deploy (nomes, símbolos, valores iniciais)
- [ ] Testar cada função principal
- [ ] Testar eventos emitidos
- [ ] Testar casos de erro (`revertedWith`)
- [ ] Testar controle de acesso (owner, authorized, unauthorized)
- [ ] Usar `time.increase` para testes com prazo
- [ ] Usar helpers (`setupUser`, `createAndAcceptOrder`) para reduzir repetição
