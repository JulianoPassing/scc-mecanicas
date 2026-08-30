import discord
from discord.ext import commands
import os
from dotenv import load_dotenv

# Carrega variáveis de ambiente (.env)
load_dotenv()

TOKEN = os.getenv('DISCORD_TOKEN')


class MyBot(commands.Bot):
    def __init__(self):
        # Intents necessárias para ler mensagens, gerenciar cargos e apelidos
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        intents.guilds = True

        super().__init__(command_prefix='!', intents=intents)

    async def setup_hook(self):
        """Carrega as extensões (cogs) e sincroniza comandos"""
        print("Iniciando carregamento das Cogs...")

        # Cog unificada: ponto + integração com o site/logs (LogForwarder)
        # O setup(bot) de cogs/ponto.py registra as duas classes de uma vez.
        try:
            await self.load_extension('cogs.ponto')
            print('✅ Cog cogs.ponto carregada com sucesso.')
        except Exception as e:
            print(f'❌ Erro ao carregar cogs.ponto: {e}')

        # Sincroniza os comandos Slash (/) com o Discord
        await self.tree.sync()
        print("✅ Comandos Slash sincronizados!")

    async def on_ready(self):
        print('------')
        print(f'Bot logado como: {self.user}')
        print(f'ID do Bot: {self.user.id}')
        print(f'Conectado em {len(self.guilds)} servidores.')
        print('------')


if __name__ == "__main__":
    bot = MyBot()
    if TOKEN:
        bot.run(TOKEN)
    else:
        print("❌ Erro: DISCORD_TOKEN não encontrado no arquivo .env")
