'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const os = require('node:os');

// In-memory token cache to prevent re-requesting access token on every voice request
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Locate Google Application Default Credentials (ADC) or .env settings
 */
function resolveCredentials() {
  const customAdcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const defaultAdcPath = path.join(os.homedir(), 'AppData', 'Roaming', 'gcloud', 'application_default_credentials.json');
  const dshEnvPath = path.join(os.homedir(), '.dsh', '.env');

  let project = process.env.GOOGLE_CLOUD_PROJECT || null;
  let location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  let adcPath = null;

  if (customAdcPath && fs.existsSync(customAdcPath)) {
    adcPath = customAdcPath;
  } else if (fs.existsSync(defaultAdcPath)) {
    adcPath = defaultAdcPath;
  }

  // Parse .dsh/.env if available
  if (fs.existsSync(dshEnvPath)) {
    try {
      const lines = fs.readFileSync(dshEnvPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [k, ...vParts] = trimmed.split('=');
        const key = k.trim();
        const val = vParts.join('=').trim();
        if (key === 'GOOGLE_APPLICATION_CREDENTIALS' && !adcPath && fs.existsSync(val)) {
          adcPath = val;
        } else if (key === 'GOOGLE_CLOUD_PROJECT' && !project) {
          project = val;
        } else if (key === 'GOOGLE_CLOUD_LOCATION') {
          location = val || 'global';
        }
      }
    } catch {}
  }

  if (!adcPath || !fs.existsSync(adcPath)) {
    throw new Error('未找到 Google Cloud 凭证文件 (application_default_credentials.json)');
  }

  const adcData = JSON.parse(fs.readFileSync(adcPath, 'utf8'));
  project = project || adcData.quota_project_id || adcData.project_id || 'project-f03baef1-6cf2-45ec-bff';

  return {
    adcData,
    project,
    location,
  };
}

/**
 * Fetch a fresh Google OAuth access token using refresh_token
 */
async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.accessToken && tokenCache.expiresAt > now + 60000) {
    return tokenCache.accessToken;
  }

  const { adcData } = resolveCredentials();

  if (!adcData.client_id || !adcData.client_secret || !adcData.refresh_token) {
    throw new Error('Google 凭证缺少 client_id / client_secret / refresh_token');
  }

  const postData = JSON.stringify({
    client_id: adcData.client_id,
    client_secret: adcData.client_secret,
    refresh_token: adcData.refresh_token,
    grant_type: 'refresh_token',
  });

  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.access_token) {
            tokenCache.accessToken = json.access_token;
            tokenCache.expiresAt = now + (json.expires_in || 3600) * 1000;
            resolve(json.access_token);
          } else {
            reject(new Error(`获取 Google Access Token 失败: ${body}`));
          }
        } catch (e) {
          reject(new Error(`解析 Token 响应失败: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求 Google Access Token 超时'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Map user-facing model identifiers to the exact Vertex AI publisher model name.
 */
function resolveVertexModel(model) {
  if (!model) return 'gemini-3.5-transcribe-preview';
  if (model === 'gemini-3.5-transcribe') return 'gemini-3.5-transcribe-preview';
  return model;
}

/**
 * Transcribe base64 encoded audio using gemini-3.5-transcribe on Google Vertex AI
 * @param {Object} opts
 * @param {string} opts.audioBase64 - base64 audio data
 * @param {string} [opts.mimeType] - audio mime type (e.g. audio/webm;codecs=opus or audio/wav)
 * @param {string} [opts.model] - model override (default: gemini-3.5-transcribe)
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeAudio({ audioBase64, mimeType = 'audio/webm', model = 'gemini-3.5-transcribe' }) {
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new Error('无效的音频数据');
  }

  const token = await getAccessToken();
  const { project, location } = resolveCredentials();
  const vertexModel = resolveVertexModel(model);

  // Strip codec metadata (e.g. audio/webm;codecs=opus -> audio/webm)
  const cleanMime = mimeType.split(';')[0].trim() || 'audio/webm';

  const endpointHost = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  const endpointPath = `/v1/projects/${project}/locations/${location}/publishers/google/models/${vertexModel}:generateContent`;

  const payload = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: audioBase64,
            },
          },
          {
            text: 'Please transcribe the spoken audio recording verbatim in its original language (e.g. Chinese/English). Add standard punctuation. If the audio contains only silence or background noise, respond with [EMPTY]. Do not include any explanations, greetings, or formatting prefixes.',
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 2048,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: endpointHost,
      path: endpointPath,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 25000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode !== 200) {
            return reject(new Error(`Vertex API 报错 (${res.statusCode}): ${json.error?.message || body}`));
          }
          const candidate = json.candidates?.[0];
          let text = candidate?.content?.parts?.[0]?.text || '';
          
          // Clean up model artifact patterns
          text = text.trim();
          if (
            text === '[EMPTY]' ||
            text === '[SILENCE]' ||
            text === '空白' ||
            text === '[空白]' ||
            text === '00:00'
          ) {
            text = '';
          }
          resolve(text);
        } catch (e) {
          reject(new Error(`解析 Vertex 响应失败: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Vertex API 转写超时'));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  transcribeAudio,
  resolveCredentials,
  getAccessToken,
};
