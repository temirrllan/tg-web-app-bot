#!/bin/bash
# scripts/find-hardcoded-language.sh
# Запустите: bash scripts/find-hardcoded-language.sh

echo "🔍 Поиск жестко заданного языка 'ru' в коде..."
echo "=========================================="
echo ""

echo "1. Поиск в JavaScript файлах:"
echo "------------------------------"
grep -r "language.*=.*['\"]ru['\"]" --include="*.js" --include="*.jsx" . 2>/dev/null | grep -v node_modules | grep -v "language_code"

echo ""
echo "2. Поиск установки языка на 'ru':"
echo "----------------------------------"
grep -r "setLanguage.*['\"]ru['\"]" --include="*.js" --include="*.jsx" . 2>/dev/null | grep -v node_modules

echo ""
echo "3. Поиск localStorage с 'ru':"
echo "-----------------------------"
grep -r "localStorage.*setItem.*['\"]ru['\"]" --include="*.js" --include="*.jsx" . 2>/dev/null | grep -v node_modules

echo ""
echo "4. Поиск дефолтных значений 'ru':"
echo "----------------------------------"
grep -r "DEFAULT.*['\"]ru['\"]" --include="*.sql" . 2>/dev/null

echo ""
echo "5. Поиск в SQL файлах:"
echo "----------------------"
grep -r "language.*DEFAULT.*['\"]ru['\"]" --include="*.sql" . 2>/dev/null

echo ""
echo "6. Поиск инициализации с 'ru':"
echo "-------------------------------"
grep -r "useState.*['\"]ru['\"]" --include="*.jsx" . 2>/dev/null | grep -v node_modules

echo ""
echo "7. Проверка package.json на дефолтные настройки:"
echo "------------------------------------------------"
grep -i "language\|locale\|lang" package.json 2>/dev/null

echo ""
echo "✅ Поиск завершен"