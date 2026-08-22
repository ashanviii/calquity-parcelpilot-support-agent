# Deployment Guide: ParcelPilot AI Support

## Local Development

### Quick Start (Recommended)

```bash
chmod +x quick-start.sh
./quick-start.sh
npm run dev
```

Then open: http://localhost:3000

### Manual Setup

1. **Install dependencies**
```bash
npm install
cd client && npm install && cd ..
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your OPENAI_API_KEY
```

3. **Run development server**
```bash
npm run dev
```

Access at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Docker Deployment

### Build and Run

```bash
# Build Docker image
docker build -t parcelpilot-ai:latest .

# Run container
docker run -p 3001:3001 \
  -e OPENAI_API_KEY=your_key_here \
  -e PORT=3001 \
  parcelpilot-ai:latest
```

### Docker Compose

```bash
docker-compose up --build
```

Access at http://localhost:3000

## Cloud Deployment Options

### Option 1: Railway (Recommended - Easiest)

1. **Push to GitHub**
```bash
git push origin main
```

2. **Create Railway Project**
   - Visit https://railway.app
   - Connect GitHub repository
   - Select root directory
   - Add environment variables:
     - OPENAI_API_KEY: your-key
     - PORT: 3001
     - NODE_ENV: production

3. **Deploy**
   - Railway auto-deploys on push
   - Get public URL from Railway dashboard

### Option 2: Vercel (Frontend) + Railway (Backend)

**Frontend on Vercel:**
```bash
cd client
npm install -g vercel
vercel deploy --prod
```

**Backend on Railway:**
```bash
# Same as Option 1
```

Then configure frontend to point to Railway backend URL.

### Option 3: AWS Lambda + S3 + CloudFront

**Frontend (S3 + CloudFront):**
```bash
cd client && npm run build

# Upload dist/ to S3
# Configure CloudFront to serve from S3
```

**Backend (Lambda):**
```bash
# Create Lambda function from Dockerfile
# Or package Node.js code directly

# Set up API Gateway for HTTP requests
# Configure environment variables
```

### Option 4: Heroku

```bash
# Install Heroku CLI
heroku login

# Create app
heroku create parcelpilot-ai-support

# Set config
heroku config:set OPENAI_API_KEY=your_key_here

# Deploy
git push heroku main

# View logs
heroku logs -t
```

### Option 5: Google Cloud Run

```bash
# Build and push to Container Registry
gcloud builds submit --tag gcr.io/PROJECT_ID/parcelpilot-ai

# Deploy
gcloud run deploy parcelpilot-ai \
  --image gcr.io/PROJECT_ID/parcelpilot-ai \
  --platform managed \
  --region us-central1 \
  --set-env-vars OPENAI_API_KEY=your_key \
  --allow-unauthenticated
```

## Production Checklist

- [ ] OPENAI_API_KEY set in environment (not .env)
- [ ] NODE_ENV=production
- [ ] CORS properly configured for production domain
- [ ] Rate limiting enabled
- [ ] Logging configured (structured JSON logs)
- [ ] Error monitoring set up (Sentry, DataDog)
- [ ] Database configured if adding persistence
- [ ] SSL/TLS certificate configured
- [ ] Domain DNS pointing to deployment
- [ ] Health checks configured
- [ ] Auto-scaling configured (if high traffic expected)
- [ ] Monitoring and alerting set up

## Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...

# Optional
PORT=3001                          # Default: 3001
NODE_ENV=production                # Default: development
LOG_LEVEL=info                     # Default: info
CORS_ORIGIN=https://example.com   # Default: *
```

## Health Checks

```bash
# Check backend is running
curl http://localhost:3001/api/health

# Check frontend is accessible
curl http://localhost:3000
```

## Monitoring

### Key Metrics to Track

- API response times
- Error rates
- OpenAI token usage/cost
- Support escalation rate
- Uptime (SLA target: 99.9%)

### Recommended Tools

- **Logging**: CloudWatch, Datadog, or Papertrail
- **Monitoring**: New Relic, Datadog, or Prometheus
- **Error Tracking**: Sentry
- **APM**: Datadog or New Relic

## Scaling Considerations

### Bottlenecks (in order)

1. **OpenAI API rate limits**
   - Solution: Queue requests, implement caching
   - Cache: Redis with TTL for policy questions

2. **LLM response latency**
   - Solution: Add streaming responses
   - Parallel tool calling where possible

3. **Database queries**
   - Solution: Connection pooling, read replicas
   - Caching layer for operational data

4. **Concurrent user connections**
   - Solution: Horizontal scaling (Kubernetes)
   - Load balancing with sticky sessions

### Deployment Architecture (High-Traffic)

```
┌─────────────────────────┐
│    Cloudflare/CDN       │
│  (Caching, WAF)         │
└────────────┬────────────┘
             │
┌────────────▼────────────┐
│   Load Balancer         │
│  (AWS ELB/ALB)          │
└────────────┬────────────┘
             │
    ┌────────┼────────┐
    │        │        │
┌───▼─┐  ┌──▼──┐  ┌──▼──┐
│ App │  │ App │  │ App │  (Kubernetes cluster)
│ Pod │  │ Pod │  │ Pod │  (Auto-scaling)
└─────┘  └─────┘  └─────┘
    │        │        │
    └────────┼────────┘
             │
    ┌────────▼────────┐
    │   Redis Cache   │
    │ (Session, Data) │
    └─────────────────┘
             │
    ┌────────▼────────┐
    │   PostgreSQL    │
    │ (Main Database) │
    └─────────────────┘
```

## Rollback Procedure

```bash
# If deployment fails, rollback to previous version

# Railway
railway rollback [previous-deployment-id]

# Heroku
heroku releases:rollback v3

# Manually
git revert HEAD
git push
```

## Support and Troubleshooting

### Common Issues

**502 Bad Gateway**
- Backend not running
- Backend port not exposed
- Firewall blocking access

**CORS errors**
- Check CORS_ORIGIN environment variable
- Ensure frontend and backend domains are different
- Check browser console for specific error

**Slow responses**
- Check OpenAI API quota
- Monitor database query performance
- Check network latency

**High costs**
- Monitor token usage with `npm run monitor`
- Implement caching for repeated queries
- Consider fine-tuned model for domain-specific queries

## Performance Optimization

### Caching Strategy

```javascript
// Cache policy question responses (24 hours)
const policyCache = new Map();
const POLICY_CACHE_TTL = 24 * 60 * 60 * 1000;

// Cache operational data (5 minutes)
const dataCache = new Map();
const DATA_CACHE_TTL = 5 * 60 * 1000;
```

### Lazy Loading

- Load data sources on demand
- Stream long responses to client
- Paginate ticket history

### Cost Optimization

- Use GPT-3.5-turbo for simple queries
- GPT-4 for complex reasoning only
- Implement query caching
- Batch similar requests

## Support

For issues with deployment, check:
1. Environment variables are set correctly
2. Network connectivity to external services
3. OpenAI API key is valid
4. Database connectivity (if using persistence)
5. Application logs for detailed error messages

Monitor the system and adjust autoscaling policies based on actual traffic patterns.
