const { execSync } = require('child_process');

console.log('🚀 Running pre-launch checks...\n');

const checks = [
  { name: 'Environment Variables', command: 'npm run check-env' },
  { name: 'Database Structure', command: 'npm run check-db' },
  { name: 'Webhook Configuration', command: 'npm run test-webhook' },
  { name: 'Payment Flow', command: 'npm run test-payment' }
];

let allPassed = true;

checks.forEach((check, index) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Check ${index + 1}/${checks.length}: ${check.name}`);
  console.log('='.repeat(60));
  
  try {
    execSync(check.command, { stdio: 'inherit' });
    console.log(`\n✅ ${check.name} - PASSED`);
  } catch (error) {
    console.log(`\n❌ ${check.name} - FAILED`);
    allPassed = false;
  }
});

console.log(`\n${'='.repeat(60)}`);
console.log('FINAL RESULT');
console.log('='.repeat(60));

if (allPassed) {
  console.log('\n🎉 All checks passed! Payment system is ready!\n');
  console.log('Next steps:');
  console.log('1. Deploy to Render');
  console.log('2. Run: npm run setup-webhook (on production)');
  console.log('3. Test with 1 XTR payment\n');
  process.exit(0);
} else {
  console.log('\n❌ Some checks failed! Please fix the issues above.\n');
  process.exit(1);
}