# LARPCheck 🤖

LARPCheck is a Twitter bot that analyzes GitHub repositories for potential AI/LLM hallucinations in documentation and code comments. It helps developers identify and verify AI-generated content in their codebases.

## Features

- 🔍 **Automated Repository Analysis**: Analyzes GitHub repositories for potential AI-generated content
- 🐦 **Twitter Integration**: Responds to mentions with `analyze` or `check` commands
- 📊 **Detailed Reports**: Provides comprehensive analysis of AI hallucinations in code
- 🚀 **Easy to Use**: Just tweet `@YourBotUsername analyze https://github.com/username/repo`

## How It Works

1. **Mention the Bot**: Tweet at your bot's account with the `analyze` or `check` command and a GitHub repository URL
2. **Repository Analysis**: The bot clones and analyzes the repository for:
   - AI-generated documentation
   - Code comments and descriptions
   - Potential hallucinations or inconsistencies
3. **Report Generation**: Receives a detailed report about findings

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- PostgreSQL
- Twitter Developer Account
- GitHub Token
- OpenAI API Key

### Environment Variables

Create a `.env` file with the following:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5433/larpcheck?schema=public"

# GitHub
GITHUB_TOKEN="your_github_token"

# OpenAI
OPENAI_API_KEY="your_openai_api_key"

# Twitter
TWITTER_USERNAME="your_twitter_username"
TWITTER_PASSWORD="your_twitter_password"

# Storage
STORAGE_PATH="./storage"
SESSION_PATH="./storage/sessions"

# App
PORT=3000
NODE_ENV="development"
```

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/larpcheck.git
cd larpcheck
```

2. Install dependencies:
```bash
npm install
```

3. Start the service:
```bash
npm run dev
```

## Architecture

- **Twitter Service**: Handles tweet monitoring and interactions
- **Repository Service**: Manages GitHub repository operations
- **Analysis Service**: Processes codebase for AI content detection
- **Storage Service**: Manages persistent data and session handling

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [agent-twitter-client](https://github.com/your-reference/agent-twitter-client)
- Uses OpenAI's GPT models for analysis
- Powered by Node.js and TypeScript

## Support

For support, please open an issue in the repository or contact the maintainers.

---

Made with ❤️ by Jefferson Ighalo 