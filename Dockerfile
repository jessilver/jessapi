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

# Ensure auth_sessions exists and is writable by the container runtime
RUN mkdir -p auth_sessions && chmod -R 777 auth_sessions

# Comando para rodar (o tsx lida bem com ESM dentro do container)
EXPOSE 3000
CMD ["npm", "run", "start"]