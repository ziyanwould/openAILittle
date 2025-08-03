# Use Node.js 18 as the base image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json to leverage Docker cache
COPY package.json ./

# Install dependencies using pnpm
RUN npm install -g pnpm && pnpm install

# Copy the rest of the application code
COPY . .

# Expose the application port (assuming 3000 for the main app and STATS_PORT from statsServer.js)
# You might need to adjust this if your main app runs on a different port.
EXPOSE 20491
EXPOSE 30491

# Command to run the application
CMD ["pnpm", "start"] 