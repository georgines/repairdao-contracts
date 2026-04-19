#!/usr/bin/env bash
set -u

hardhat_status=0
slither_status=0
mythril_status=0

echo "==> Preparando ambiente"
mkdir -p tools/slither/output
mkdir -p tools/mythril/output

echo "==> Limpando relatórios antigos"
rm -f tools/slither/output/*.json
rm -f tools/mythril/output/*.json

echo "==> Verificando solc-select"
if ! command -v solc-select >/dev/null 2>&1; then
  echo "Instalando solc-select..."
  pip install solc-select
fi

echo "==> Instalando solc 0.8.24 (se necessário)"
solc-select install 0.8.24 || true

echo "==> Usando solc 0.8.24"
solc-select use 0.8.24

echo "==> Verificando versão do solc"
if ! solc --version | grep -q "0.8.24"; then
  echo "ERRO: solc não está na versão 0.8.24"
  exit 1
fi

echo "==> Testes (Hardhat)"
set +e
yarn hardhat test
hardhat_status=$?
set -e

if [ "$hardhat_status" -ne 0 ]; then
  echo "ERRO: Hardhat falhou com código $hardhat_status"
fi

echo "==> Slither (JSON)"
set +e
slither . --json tools/slither/output/slither-report.json
slither_status=$?
set -e

if [ "$slither_status" -ne 0 ]; then
  echo "Aviso: Slither retornou código $slither_status, seguindo para o Mythril..."
fi

echo "==> Mythril (JSON por contrato)"
for file in contracts/*.sol; do
  name=$(basename "$file" .sol)
  linux_path=$(echo "$file" | sed 's|\\|/|g')
  output_file="tools/mythril/output/$name.json"

  echo "Analisando $name..."

  set +e
  docker run --rm \
    -v "$(pwd):/src" \
    mythril/myth analyze "/src/$linux_path" \
    --solc-json "/src/tools/mythril/remapping.json" \
    --execution-timeout 300 \
    --max-depth 128 \
    --transaction-count 5 \
    -o jsonv2 \
    > "$output_file"
  docker_status=$?
  set -e

  if [ "$docker_status" -ne 0 ]; then
    echo "ERRO: Mythril falhou ao executar para $name"
    mythril_status=1
    continue
  fi

  if grep -q 'FileNotFoundError' "$output_file"; then
    echo "ERRO: Mythril gerou erro interno em $name"
    mythril_status=1
    continue
  fi

  if grep -q '"level": "error"' "$output_file"; then
    echo "ERRO: Mythril registrou erro interno em $name"
    mythril_status=1
    continue
  fi

  if ! grep -q '"issues"' "$output_file"; then
    echo "ERRO: JSON inválido ou incompleto em $name"
    mythril_status=1
    continue
  fi
done

echo "==> Resumo final"
echo "Hardhat: $hardhat_status"
echo "Slither: $slither_status"
echo "Mythril: $mythril_status"

if [ "$hardhat_status" -ne 0 ] || [ "$mythril_status" -ne 0 ]; then
  echo "Validação finalizou com erros"
  exit 1
fi

echo "Validação concluída com sucesso"
exit 0