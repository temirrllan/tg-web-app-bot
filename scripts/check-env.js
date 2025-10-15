require('dotenv').config();

console.log('🔍 Checking environment variables...\n');

const requiredVars = {
  'BOT_TOKEN': process.env.BOT_TOKEN,
  'BOT_SECRET': process.env.BOT_SECRET,
  'BACKEND_PUBLIC_URL': process.env.BACKEND_PUBLIC_URL,
  'FRONTEND_URL': process.env.FRONTEND_URL,
  'WEBAPP_URL': process.env.WEBAPP_URL,
  'DATABASE_URL': process.env.DATABASE_URL
};

let allPresent = true;

Object.entries(requiredVars).forEach(([key, value]) => {
  if (value) {
    const displayValue = key.includes('TOKEN') || key.includes('SECRET') || key.includes('DATABASE') 
      ? value.substring(0, 10) + '...' 
      : value;
    console.log(`✅ ${key}: ${displayValue}`);
  } else {
    console.log(`❌ ${key}: NOT SET`);
    allPresent = false;
  }
});

console.log('');

if (allPresent) {
  console.log('✅ All required environment variables are set!\n');
  
  // Проверка корректности URL
  console.log('🔍 Checking URL formats...\n');
  
  if (process.env.BACKEND_PUBLIC_URL) {
    if (!process.env.BACKEND_PUBLIC_URL.startsWith('https://')) {
      console.log('⚠️ BACKEND_PUBLIC_URL should start with https://');
    } else {
      console.log('✅ BACKEND_PUBLIC_URL format is correct');
    }
  }
  
  if (process.env.WEBAPP_URL) {
    if (!process.env.WEBAPP_URL.startsWith('https://')) {
      console.log('⚠️ WEBAPP_URL should start with https://');
    } else {
      console.log('✅ WEBAPP_URL format is correct');
    }
  }
  
  console.log('');
  process.exit(0);
} else {
  console.log('❌ Some environment variables are missing!\n');
  console.log('Please set them in your .env file or Render dashboard.\n');
  process.exit(1);
}