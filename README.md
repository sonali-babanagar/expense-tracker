# Expense Tracker 💰

A smart expense tracking application with AI-powered categorization, trip budgeting, and real-time database synchronization.

## ✨ Features

- **AI-Powered Categorization**: Uses Groq LLM to automatically categorize expenses
- **Trip Management**: Create and manage trip budgets with separate expense tracking
- **Real-time Sync**: Supabase integration for instant data synchronization
- **Date Filtering**: Filter expenses by date range
- **Category Management**: Create, view, and delete custom categories
- **Multi-kind Tracking**: Track expenses, borrowed money, and lended amounts
- **Authentication**: Secure email/password authentication with magic link support
- **Mobile Responsive**: Fully optimized for mobile and desktop devices

## 🛠️ Tech Stack

- **Frontend**: React 18 + Vite
- **Database**: Supabase (PostgreSQL)
- **AI**: Groq API (LLM categorization)
- **Date Handling**: date-fns
- **API**: OpenAI SDK (for Groq compatibility)

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account
- Groq API key

### Installation

```bash
# Clone repository
git clone https://github.com/sonali-babanagar/expense-tracker.git
cd expense-tracker

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Update .env with your credentials
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_key
VITE_GROQ_API_KEY=your_groq_api_key

# Start development server
npm run dev
```

Visit `http://localhost:5173`

## 📦 Build

```bash
npm run build
```

Production files will be in `dist/` directory.

## 🌐 Deployment

### Deploy to Netlify

1. Push code to GitHub
2. Go to [Netlify](https://app.netlify.com)
3. Click "New site from Git"
4. Select your repository
5. Add environment variables in Site settings
6. Deploy!

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.

## 📱 Mobile Support

✅ Fully responsive design
✅ Touch-friendly interface
✅ Works on iOS and Android
✅ Optimized for all screen sizes

## 🔐 Security

- Supabase Row-Level Security (RLS) enabled
- API keys stored securely in environment variables
- No sensitive data stored in browser

## 📝 Project Structure

```
src/
├── components/
│   ├── Auth.jsx              # Authentication UI
│   ├── Dashboard.jsx         # Main expense display
│   ├── ExpenseInput.jsx      # Expense creation form
│   └── TripsTab.jsx          # Trip management
├── lib/
│   ├── groqCategorizer.js    # AI categorization logic
│   └── supabaseClient.jsx    # Supabase initialization
├── App.jsx                   # Main app component
├── main.jsx                  # Entry point
└── styles.css                # Global styles
```

## 🤖 AI Categorization

Expenses are automatically categorized using Groq's LLM with fallback to keyword-based categorization:
- **Primary**: LLM with prompt about available categories
- **Fallback**: Manual keyword matching
- **Default**: "Other" category

## 🐛 Troubleshooting

**Blank page on load?**
- Check browser console for errors
- Verify environment variables are set
- Clear cache (Ctrl+Shift+R)

**Cannot create account?**
- Disable email confirmation in Supabase authentication settings
- Check email is valid format

**Expenses not categorizing?**
- Verify Groq API key is valid
- Check internet connection
- See browser console for detailed errors

## 📄 License

MIT License

## 👤 Author

[Sonali Babanagar](https://github.com/sonali-babanagar)

## 💬 Support

For issues and questions, please open a GitHub issue.

---

**Ready to track your expenses smartly?** [Deploy now](DEPLOYMENT.md) 🚀
