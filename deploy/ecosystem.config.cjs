module.exports = {
  apps: [
    {
      name: "scc-mecanicas-api",
      cwd: "./apps/api",
      script: "dist/index.js",
      interpreter: "node",
      env: { NODE_ENV: "production" },
      env_file: ".env",
    },
    {
      name: "scc-mecanicas-bot",
      cwd: "./bot",
      script: "main.py",
      interpreter: "python3",
    },
  ],
};
