// scripts/test-language-detection.js
// Запуск: node scripts/test-language-detection.js

function detectLanguage(language_code) {
  let initialLanguage = 'en'; // По умолчанию английский
  
  if (language_code) {
    const langCode = language_code.toLowerCase().trim();
    console.log(`Testing: "${language_code}" → normalized: "${langCode}"`);
    
    // Проверка на казахский
    if (langCode === 'kk' || langCode === 'kz' || 
        langCode.startsWith('kk-') || langCode.startsWith('kk_') ||
        langCode.startsWith('kz-') || langCode.startsWith('kz_')) {
      initialLanguage = 'kk';
    }
    // Проверка на русский
    else if (langCode === 'ru' || 
             langCode.startsWith('ru-') || langCode.startsWith('ru_')) {
      initialLanguage = 'ru';
    }
    // Проверка на английский
    else if (langCode === 'en' || 
             langCode.startsWith('en-') || langCode.startsWith('en_')) {
      initialLanguage = 'en';
    }
    // Любой другой язык - английский по умолчанию
    else {
      initialLanguage = 'en';
    }
  } else {
    console.log('No language_code provided');
  }
  
  return initialLanguage;
}

// Тестовые случаи
const testCases = [
  // Казахский
  'kk', 'KK', 'kk-KZ', 'kk_KZ',
  'kz', 'KZ', 'kz-KZ', 'kz_KZ',
  
  // Русский
  'ru', 'RU', 'ru-RU', 'ru_RU', 'ru-UA',
  
  // Английский
  'en', 'EN', 'en-US', 'en_US', 'en-GB', 'en_GB',
  
  // Другие языки (должны стать en)
  'fr', 'de', 'es', 'it', 'pt', 'zh', 'ja', 'ko', 'ar',
  'fr-FR', 'de-DE', 'es-ES', 'zh-CN',
  
  // Пустые/невалидные
  null, undefined, '', '  ', 'xyz', '123'
];

console.log('=== Language Detection Test ===\n');

const results = {
  kk: [],
  ru: [],
  en: []
};

testCases.forEach(testCase => {
  const result = detectLanguage(testCase);
  const display = testCase === null ? 'null' : 
                  testCase === undefined ? 'undefined' : 
                  testCase === '' ? '(empty string)' : 
                  `"${testCase}"`;
  
  console.log(`${display.padEnd(20)} → ${result}`);
  results[result].push(display);
});

console.log('\n=== Summary ===');
console.log(`Kazakh (kk): ${results.kk.length} cases`);
console.log('  ', results.kk.join(', '));
console.log(`Russian (ru): ${results.ru.length} cases`);
console.log('  ', results.ru.join(', '));
console.log(`English (en): ${results.en.length} cases`);
console.log('  ', results.en.join(', '));

// Проверка на ошибки
console.log('\n=== Validation ===');
const expectedKk = ['"kk"', '"KK"', '"kk-KZ"', '"kk_KZ"', '"kz"', '"KZ"', '"kz-KZ"', '"kz_KZ"'];
const expectedRu = ['"ru"', '"RU"', '"ru-RU"', '"ru_RU"', '"ru-UA"'];
const expectedEn = testCases.length - expectedKk.length - expectedRu.length;

const errors = [];

// Проверяем, что казахские коды определяются как kk
expectedKk.forEach(code => {
  if (!results.kk.includes(code)) {
    errors.push(`❌ ${code} should be detected as 'kk'`);
  }
});

// Проверяем, что русские коды определяются как ru
expectedRu.forEach(code => {
  if (!results.ru.includes(code)) {
    errors.push(`❌ ${code} should be detected as 'ru'`);
  }
});

if (errors.length > 0) {
  console.log('\n❌ ERRORS FOUND:');
  errors.forEach(error => console.log(error));
} else {
  console.log('\n✅ All tests passed!');
}