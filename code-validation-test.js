/**
 * Life Tracker - Code Validation Test
 * 
 * This Node.js script validates the implementation against the CLAUDE.md requirements
 * by analyzing the actual source code files for compliance with the hard rules.
 */

const fs = require('fs');
const path = require('path');

// CLAUDE.md Hard Rules to validate
const HARD_RULES = {
    userIdRule: {
        description: "MAI introdurre fallback user finti (es: 'user-1')",
        pattern: /user-1|fake-user|dummy-user|test-user-[0-9]/gi,
        severity: 'critical'
    },
    noDataOverwrite: {
        description: "MAI modificare/sovrascrivere dati già salvati",
        pattern: /\.overwrite\(|\.replace\(|force.*update|destructive.*update/gi,
        severity: 'critical'
    },
    noAutoWipe: {
        description: "Niente wipe automatici del DB",
        pattern: /\.clear\(\)|\.wipe\(\)|\.deleteAll\(\)|\.truncate\(\)/gi,
        severity: 'high'
    },
    buildSuccess: {
        description: "build sempre verde: npm run build deve passare",
        files: ['tsconfig.json', 'package.json', 'next.config.js'],
        severity: 'critical'
    }
};

// Progress Rules to validate
const PROGRESS_RULES = {
    actualHoursCalculation: {
        description: "Actual hours = Sum of durations from completed TimeBlocks",
        pattern: /status\s*===\s*['"']completed['"']/gi,
        requiredFiles: ['src/providers/DataProvider.tsx', 'src/lib/database.ts'],
        severity: 'high'
    },
    rollupHierarchy: {
        description: "TimeBlock -> Task -> Project -> Goal rollup",
        pattern: /taskId|projectId|goalId/gi,
        requiredFiles: ['src/components/TimeBlockPlanner.tsx'],
        severity: 'high'
    },
    timeBlockLifecycle: {
        description: "planned → in_progress → completed lifecycle",
        pattern: /planned|in_progress|completed|cancelled|overrun/gi,
        requiredFiles: ['src/types/index.ts', 'src/components/TimeBlockPlanner.tsx'],
        severity: 'medium'
    }
};

// Auth UX Rules to validate
const AUTH_RULES = {
    authGate: {
        description: "AuthGate prevents UI rendering before login",
        pattern: /AuthGate|status.*===.*signedOut/gi,
        requiredFiles: ['src/app/page.tsx'],
        severity: 'critical'
    },
    noFallbackUser: {
        description: "No fallback user implementation",
        pattern: /fallback.*user|default.*user|guest.*user.*=.*['"'][^'"]+['"']/gi,
        severity: 'high'
    }
};

// File analyzer function
function analyzeFile(filePath, rules) {
    const results = [];
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const fileName = path.basename(filePath);
        
        for (const [ruleId, rule] of Object.entries(rules)) {
            const matches = content.match(rule.pattern) || [];
            
            results.push({
                ruleId,
                description: rule.description,
                fileName,
                filePath,
                matches: matches.length,
                matchedText: matches.slice(0, 3), // First 3 matches
                severity: rule.severity,
                passed: rule.severity === 'critical' ? matches.length === 0 : true
            });
        }
    } catch (error) {
        results.push({
            ruleId: 'file_error',
            description: `Error reading file: ${filePath}`,
            error: error.message,
            passed: false,
            severity: 'critical'
        });
    }
    
    return results;
}

// Directory scanner
function scanDirectory(dirPath, filePattern = /\.(tsx?|js|json)$/) {
    const files = [];
    
    try {
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && !item.includes('node_modules') && !item.includes('.next')) {
                files.push(...scanDirectory(fullPath, filePattern));
            } else if (stat.isFile() && filePattern.test(item)) {
                files.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error.message);
    }
    
    return files;
}

// Main validation function
function runCodeValidation(projectPath = '.') {
    console.log('🔍 Running Code Validation Tests...');
    console.log('===================================');
    
    const results = {
        hardRules: [],
        progressRules: [],
        authRules: [],
        summary: {
            totalFiles: 0,
            criticalIssues: 0,
            highIssues: 0,
            mediumIssues: 0,
            passed: true
        }
    };
    
    // Scan for relevant files
    const allFiles = scanDirectory(path.join(projectPath, 'src'));
    results.summary.totalFiles = allFiles.length;
    
    console.log(`📁 Found ${allFiles.length} files to analyze`);
    
    // Test Hard Rules
    console.log('\n🚫 Validating Hard Rules...');
    for (const file of allFiles) {
        const fileResults = analyzeFile(file, HARD_RULES);
        results.hardRules.push(...fileResults);
    }
    
    // Test Progress Rules
    console.log('\n📊 Validating Progress Rules...');
    for (const [ruleId, rule] of Object.entries(PROGRESS_RULES)) {
        if (rule.requiredFiles) {
            for (const requiredFile of rule.requiredFiles) {
                const fullPath = path.join(projectPath, requiredFile);
                if (fs.existsSync(fullPath)) {
                    const fileResults = analyzeFile(fullPath, { [ruleId]: rule });
                    results.progressRules.push(...fileResults);
                } else {
                    results.progressRules.push({
                        ruleId,
                        description: rule.description,
                        filePath: requiredFile,
                        error: 'Required file not found',
                        passed: false,
                        severity: rule.severity
                    });
                }
            }
        }
    }
    
    // Test Auth Rules  
    console.log('\n🔒 Validating Auth Rules...');
    for (const [ruleId, rule] of Object.entries(AUTH_RULES)) {
        if (rule.requiredFiles) {
            for (const requiredFile of rule.requiredFiles) {
                const fullPath = path.join(projectPath, requiredFile);
                if (fs.existsSync(fullPath)) {
                    const fileResults = analyzeFile(fullPath, { [ruleId]: rule });
                    results.authRules.push(...fileResults);
                }
            }
        }
    }
    
    // Count issues by severity
    const allResults = [...results.hardRules, ...results.progressRules, ...results.authRules];
    
    for (const result of allResults) {
        if (!result.passed) {
            switch (result.severity) {
                case 'critical':
                    results.summary.criticalIssues++;
                    break;
                case 'high':
                    results.summary.highIssues++;
                    break;
                case 'medium':
                    results.summary.mediumIssues++;
                    break;
            }
        }
    }
    
    results.summary.passed = results.summary.criticalIssues === 0;
    
    // Print results
    console.log('\n📊 VALIDATION SUMMARY');
    console.log('=====================');
    console.log(`Files Analyzed: ${results.summary.totalFiles}`);
    console.log(`Critical Issues: ${results.summary.criticalIssues}`);
    console.log(`High Issues: ${results.summary.highIssues}`);
    console.log(`Medium Issues: ${results.summary.mediumIssues}`);
    console.log(`Overall Status: ${results.summary.passed ? '✅ PASS' : '❌ FAIL'}`);
    
    // Print critical issues
    if (results.summary.criticalIssues > 0) {
        console.log('\n🚨 CRITICAL ISSUES:');
        allResults
            .filter(r => r.severity === 'critical' && !r.passed)
            .forEach(issue => {
                console.log(`❌ ${issue.description}`);
                console.log(`   File: ${issue.filePath || issue.fileName}`);
                if (issue.matchedText) {
                    console.log(`   Found: ${issue.matchedText.join(', ')}`);
                }
                if (issue.error) {
                    console.log(`   Error: ${issue.error}`);
                }
            });
    }
    
    // Print high issues
    if (results.summary.highIssues > 0) {
        console.log('\n⚠️  HIGH PRIORITY ISSUES:');
        allResults
            .filter(r => r.severity === 'high' && !r.passed)
            .forEach(issue => {
                console.log(`⚠️  ${issue.description}`);
                console.log(`   File: ${issue.filePath || issue.fileName}`);
                if (issue.matchedText) {
                    console.log(`   Found: ${issue.matchedText.join(', ')}`);
                }
            });
    }
    
    return results;
}

// Package.json validation
function validatePackageJson(projectPath = '.') {
    console.log('\n📦 Validating Package Configuration...');
    
    const packagePath = path.join(projectPath, 'package.json');
    const results = {
        exists: false,
        hasValidScripts: false,
        hasRequiredDependencies: false,
        issues: []
    };
    
    try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        results.exists = true;
        
        // Check required scripts
        const requiredScripts = ['dev', 'build', 'start'];
        const hasAllScripts = requiredScripts.every(script => packageJson.scripts?.[script]);
        results.hasValidScripts = hasAllScripts;
        
        if (!hasAllScripts) {
            const missingScripts = requiredScripts.filter(script => !packageJson.scripts?.[script]);
            results.issues.push(`Missing scripts: ${missingScripts.join(', ')}`);
        }
        
        // Check required dependencies
        const requiredDeps = ['next', 'react', 'react-dom', 'typescript'];
        const hasAllDeps = requiredDeps.every(dep => 
            packageJson.dependencies?.[dep] || packageJson.devDependencies?.[dep]
        );
        results.hasRequiredDependencies = hasAllDeps;
        
        if (!hasAllDeps) {
            const missingDeps = requiredDeps.filter(dep =>
                !packageJson.dependencies?.[dep] && !packageJson.devDependencies?.[dep]
            );
            results.issues.push(`Missing dependencies: ${missingDeps.join(', ')}`);
        }
        
        console.log(`✅ Package.json validation: ${results.issues.length === 0 ? 'PASS' : 'ISSUES FOUND'}`);
        results.issues.forEach(issue => console.log(`   ⚠️  ${issue}`));
        
    } catch (error) {
        results.issues.push(`Error reading package.json: ${error.message}`);
        console.log(`❌ Package.json validation: FAIL`);
        console.log(`   Error: ${error.message}`);
    }
    
    return results;
}

// TypeScript configuration validation
function validateTSConfig(projectPath = '.') {
    console.log('\n📘 Validating TypeScript Configuration...');
    
    const tsconfigPath = path.join(projectPath, 'tsconfig.json');
    const results = {
        exists: false,
        hasValidConfig: false,
        issues: []
    };
    
    try {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
        results.exists = true;
        
        // Check for essential compiler options
        const compilerOptions = tsconfig.compilerOptions || {};
        
        const requiredOptions = {
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            jsx: 'preserve'
        };
        
        for (const [option, expectedValue] of Object.entries(requiredOptions)) {
            if (compilerOptions[option] !== expectedValue) {
                results.issues.push(`${option} should be ${expectedValue}, got ${compilerOptions[option]}`);
            }
        }
        
        results.hasValidConfig = results.issues.length === 0;
        
        console.log(`${results.hasValidConfig ? '✅' : '⚠️ '} TypeScript config: ${results.hasValidConfig ? 'PASS' : 'ISSUES FOUND'}`);
        results.issues.forEach(issue => console.log(`   ⚠️  ${issue}`));
        
    } catch (error) {
        results.issues.push(`Error reading tsconfig.json: ${error.message}`);
        console.log(`❌ TypeScript config validation: FAIL`);
        console.log(`   Error: ${error.message}`);
    }
    
    return results;
}

// Main execution function
function main() {
    console.log('🧪 Life Tracker Code Validation');
    console.log('=================================');
    
    const projectPath = process.argv[2] || '.';
    
    try {
        // Run all validations
        const codeResults = runCodeValidation(projectPath);
        const packageResults = validatePackageJson(projectPath);
        const tsconfigResults = validateTSConfig(projectPath);
        
        // Overall summary
        const overallPassed = codeResults.summary.passed && 
                             packageResults.issues.length === 0 && 
                             tsconfigResults.issues.length === 0;
        
        console.log('\n🏁 FINAL VALIDATION RESULT');
        console.log('===========================');
        console.log(`Code Validation: ${codeResults.summary.passed ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Package Config: ${packageResults.issues.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`TypeScript Config: ${tsconfigResults.issues.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`\nOVERALL: ${overallPassed ? '🎉 ALL VALIDATIONS PASSED' : '🚨 ISSUES FOUND - FIX REQUIRED'}`);
        
        // Return results for programmatic use
        return {
            passed: overallPassed,
            results: {
                code: codeResults,
                package: packageResults,
                typescript: tsconfigResults
            }
        };
        
    } catch (error) {
        console.error('❌ Validation error:', error);
        return { passed: false, error: error.message };
    }
}

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        runCodeValidation,
        validatePackageJson,
        validateTSConfig,
        main
    };
}

// Run if executed directly
if (require.main === module) {
    main();
}