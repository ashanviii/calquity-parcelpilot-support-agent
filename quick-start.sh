#!/bin/bash
set -e

echo "🚀 ParcelPilot AI Support - Quick Start"
echo "========================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 16+ first."
    exit 1
fi

echo "✓ Node.js $(node --version) found"

# Check .env file
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo ""
    echo "📝 Please edit .env and add your OPENAI_API_KEY"
    echo "   Then run this script again."
    exit 1
fi

# Check OpenAI API key
if ! grep -q "OPENAI_API_KEY=" .env || grep "OPENAI_API_KEY=your_openai_api_key_here" .env > /dev/null; then
    echo "❌ Please configure OPENAI_API_KEY in .env file"
    exit 1
fi

echo "✓ .env configured"
echo ""

# Install root dependencies
echo "📦 Installing root dependencies..."
npm install --legacy-peer-deps

# Install client dependencies
echo "📦 Installing client dependencies..."
cd client
npm install --legacy-peer-deps
cd ..

echo ""
echo "✅ All dependencies installed!"
echo ""
echo "🎯 Ready to run:"
echo ""
echo "   Development mode (both server + client):"
echo "   npm run dev"
echo ""
echo "   Or run separately:"
echo "   Terminal 1: npm run dev:server"
echo "   Terminal 2: npm run dev:client"
echo ""
echo "   Then open: http://localhost:3000"
echo ""
echo "📚 For more info, see README.md"
echo ""
