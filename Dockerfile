# Usa imagem oficial do Node
FROM node:20-alpine

# Diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependência e instala
COPY package*.json ./
RUN npm install

# Copia todo o restante do código
COPY . .

# Expõe a porta da aplicação
EXPOSE 80

# Comando de inicialização
CMD ["npm", "start"]
