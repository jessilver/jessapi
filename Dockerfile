# Usando a versão mais estável do Node para ESM
FROM node:20-slim

# Instalando dependências necessárias para bibliotecas de imagem/qr code
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiando arquivos de dependência
COPY package*.json ./

# Instalando dependências
RUN npm install

# Copiando o resto do código
COPY . .

# Comando para rodar (o tsx lida bem com ESM dentro do container)
CMD ["npx", "tsx", "src/index.ts"]