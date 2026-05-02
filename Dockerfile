FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Source is mounted as a volume for hot reload — do not COPY src/ here
EXPOSE 5173

CMD ["npm", "run", "dev"]
