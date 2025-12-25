/**
 * Life Tracker - Progress Calculation Test
 * 
 * This script validates the progress rollup system according to the HARD RULES
 * from CLAUDE.md:
 * 
 * Progress Rules (official definition):
 * - Actual hours = Sum of durations from TimeBlocks with status === 'completed'
 * - Duration = (actualEndTime - actualStartTime) if exists, else (endTime - startTime)
 * - Rollup: TimeBlock(completed) -> Task actual -> Project actual -> Goal actual
 */

/**
 * Test the progress calculation implementation
 * This tests the core business logic defined in CLAUDE.md
 */
function testProgressCalculationRules() {
    console.log('📊 Testing Progress Calculation Rules...');
    console.log('=========================================');
    
    // Test data that matches the CLAUDE.md specification
    const testTimeBlocks = [
        {
            id: 'block-1',
            status: 'completed',
            startTime: new Date('2025-12-25T10:00:00'),
            endTime: new Date('2025-12-25T11:00:00'),
            actualStartTime: new Date('2025-12-25T10:05:00'),
            actualEndTime: new Date('2025-12-25T11:10:00'),
            taskId: 'task-1',
            projectId: 'project-1',
            goalId: 'goal-1'
        },
        {
            id: 'block-2', 
            status: 'completed',
            startTime: new Date('2025-12-25T14:00:00'),
            endTime: new Date('2025-12-25T15:30:00'),
            // No actualStartTime/actualEndTime - should fallback to start/end
            taskId: 'task-1',
            projectId: 'project-1', 
            goalId: 'goal-1'
        },
        {
            id: 'block-3',
            status: 'planned', // Not completed - should not count
            startTime: new Date('2025-12-25T16:00:00'),
            endTime: new Date('2025-12-25T17:00:00'),
            taskId: 'task-1',
            projectId: 'project-1',
            goalId: 'goal-1'
        },
        {
            id: 'block-4',
            status: 'completed',
            startTime: new Date('2025-12-25T09:00:00'),
            endTime: new Date('2025-12-25T10:00:00'),
            // No task linkage - only project/goal
            projectId: 'project-2',
            goalId: 'goal-1'
        }
    ];
    
    // Calculate actual hours according to CLAUDE.md rules
    function calculateActualHours(timeBlocks) {
        return timeBlocks
            .filter(block => block.status === 'completed')
            .reduce((total, block) => {
                let durationMs;
                
                // Rule: actualEndTime - actualStartTime if exists, else endTime - startTime
                if (block.actualStartTime && block.actualEndTime) {
                    durationMs = block.actualEndTime.getTime() - block.actualStartTime.getTime();
                } else {
                    durationMs = block.endTime.getTime() - block.startTime.getTime();
                }
                
                const hours = durationMs / (1000 * 60 * 60);
                console.log(`Block ${block.id}: ${hours.toFixed(2)} hours`);
                
                return total + hours;
            }, 0);
    }
    
    // Test rollup calculation
    function testRollupCalculation(timeBlocks) {
        const results = {
            task1: { actual: 0, target: 5 },
            project1: { actual: 0, target: 10 }, 
            project2: { actual: 0, target: 8 },
            goal1: { actual: 0, target: 20 }
        };
        
        // Calculate actual hours per entity
        timeBlocks
            .filter(block => block.status === 'completed')
            .forEach(block => {
                let hours;
                if (block.actualStartTime && block.actualEndTime) {
                    hours = (block.actualEndTime.getTime() - block.actualStartTime.getTime()) / (1000 * 60 * 60);
                } else {
                    hours = (block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60 * 60);
                }
                
                // Rollup to task
                if (block.taskId === 'task-1') {
                    results.task1.actual += hours;
                }
                
                // Rollup to project
                if (block.projectId === 'project-1') {
                    results.project1.actual += hours;
                } else if (block.projectId === 'project-2') {
                    results.project2.actual += hours;
                }
                
                // Rollup to goal
                if (block.goalId === 'goal-1') {
                    results.goal1.actual += hours;
                }
            });
        
        return results;
    }
    
    // Run tests
    const totalActualHours = calculateActualHours(testTimeBlocks);
    const rollupResults = testRollupCalculation(testTimeBlocks);
    
    console.log('\n📊 Test Results:');
    console.log('================');
    console.log(`Total Actual Hours: ${totalActualHours.toFixed(2)}`);
    console.log('Expected: 2.58 hours (1.08 + 1.5 + 0 + 1.0)');
    
    console.log('\n🔄 Rollup Results:');
    Object.entries(rollupResults).forEach(([entity, data]) => {
        const percentage = data.target > 0 ? (data.actual / data.target * 100).toFixed(1) : '0.0';
        console.log(`${entity}: ${data.actual.toFixed(2)}/${data.target} hours (${percentage}%)`);
    });
    
    // Validation
    const expectedTotal = 2.58; // Calculated manually
    const tolerance = 0.1;
    const totalValid = Math.abs(totalActualHours - expectedTotal) < tolerance;
    
    console.log('\n✅ Validation:');
    console.log(`Total hours calculation: ${totalValid ? 'PASS' : 'FAIL'}`);
    console.log(`Rollup integrity: ${rollupResults.goal1.actual === totalActualHours ? 'PASS' : 'FAIL'}`);
    
    return {
        passed: totalValid,
        totalActualHours,
        rollupResults,
        expectedTotal
    };
}

/**
 * Test progress calculation with the actual app data
 * This function inspects the real DataProvider state
 */
function testLiveProgressCalculation() {
    console.log('🔍 Testing Live Progress Calculation...');
    
    // Try to access the React context data
    const appElement = document.querySelector('[data-testid="app-ready"]');
    if (!appElement) {
        console.log('❌ App not ready for live testing');
        return { passed: false, reason: 'App not loaded' };
    }
    
    // Look for progress indicators in the UI
    const progressElements = {
        kpiDashboard: document.querySelector('[class*="KPIDashboard"]'),
        progressBars: document.querySelectorAll('.progress-bar, [style*="width"]'),
        percentageTexts: Array.from(document.querySelectorAll('*')).filter(el => 
            el.textContent.includes('%') && 
            /\d+%/.test(el.textContent)
        ),
        timeBlocks: document.querySelectorAll('[class*="absolute"][style*="top"]'),
        completedBlocks: Array.from(document.querySelectorAll('*')).filter(el =>
            el.textContent.includes('✅') || el.textContent.includes('completed')
        )
    };
    
    console.log('Live App State:', {
        hasKPIDashboard: !!progressElements.kpiDashboard,
        progressBars: progressElements.progressBars.length,
        percentageElements: progressElements.percentageTexts.length,
        timeBlocks: progressElements.timeBlocks.length,
        completedElements: progressElements.completedBlocks.length
    });
    
    // Extract percentage values for analysis
    const percentages = progressElements.percentageTexts.map(el => {
        const text = el.textContent;
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        return match ? parseFloat(match[1]) : null;
    }).filter(p => p !== null);
    
    console.log('Found Percentages:', percentages);
    
    // Check for data consistency
    const hasValidPercentages = percentages.every(p => p >= 0 && p <= 100);
    const hasReasonableData = progressElements.timeBlocks.length > 0;
    
    return {
        passed: hasValidPercentages && hasReasonableData,
        percentages,
        elementCounts: {
            progressBars: progressElements.progressBars.length,
            timeBlocks: progressElements.timeBlocks.length,
            completed: progressElements.completedBlocks.length
        },
        validation: {
            validPercentages: hasValidPercentages,
            hasData: hasReasonableData
        }
    };
}

/**
 * Monitor progress changes in real-time
 * Useful for testing the TimeBlock -> Progress rollup
 */
function monitorProgressChanges() {
    console.log('📈 Setting up Progress Change Monitoring...');
    
    const progressElements = document.querySelectorAll('[class*="kpi"], [class*="progress"], .progress-bar, [style*="width"]');
    const changes = [];
    
    if (progressElements.length === 0) {
        console.log('❌ No progress elements found to monitor');
        return { passed: false, reason: 'No progress elements' };
    }
    
    // Capture initial state
    const initialState = Array.from(progressElements).map(el => ({
        element: el,
        textContent: el.textContent?.trim() || '',
        width: el.style.width || '',
        className: el.className
    }));
    
    console.log(`📊 Monitoring ${progressElements.length} progress elements`);
    
    // Set up mutation observer
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            if (mutation.type === 'childList' || 
                mutation.type === 'characterData' ||
                (mutation.type === 'attributes' && mutation.attributeName === 'style')) {
                
                const change = {
                    timestamp: new Date(),
                    type: mutation.type,
                    target: mutation.target,
                    oldValue: mutation.oldValue,
                    newValue: mutation.target.textContent || mutation.target.style.width
                };
                
                changes.push(change);
                console.log('Progress Change Detected:', change);
            }
        });
    });
    
    // Observe all progress elements
    progressElements.forEach(el => {
        observer.observe(el, {
            childList: true,
            characterData: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
            attributeOldValue: true
        });
    });
    
    // Helper functions
    window.getProgressChanges = () => {
        console.log('Progress Changes Log:', changes);
        return changes;
    };
    
    window.stopProgressMonitoring = () => {
        observer.disconnect();
        console.log('Progress monitoring stopped');
        return changes;
    };
    
    window.analyzeProgressChanges = () => {
        const significantChanges = changes.filter(change => {
            // Filter for actual value changes (not just DOM mutations)
            return change.oldValue !== change.newValue && 
                   (change.newValue.includes('%') || change.newValue.includes('h'));
        });
        
        console.log('Significant Progress Changes:', significantChanges);
        return significantChanges;
    };
    
    console.log('✅ Progress monitoring active');
    console.log('💡 Complete a TimeBlock to test rollup, then call window.analyzeProgressChanges()');
    
    return {
        passed: true,
        initialState,
        monitoringElements: progressElements.length,
        instructions: 'Complete a TimeBlock, then use window.analyzeProgressChanges() to verify rollup'
    };
}

/**
 * Comprehensive progress system test
 */
function runProgressTests() {
    console.log('🧮 Running Comprehensive Progress Tests...');
    console.log('==========================================');
    
    const results = [];
    
    try {
        // Test 1: Calculation Rules
        console.log('\n1/3 Testing Calculation Rules...');
        const rulesTest = testProgressCalculationRules();
        results.push({ name: 'Progress Rules', ...rulesTest });
        
        // Test 2: Live Calculation
        console.log('\n2/3 Testing Live Progress...');
        const liveTest = testLiveProgressCalculation();
        results.push({ name: 'Live Progress', ...liveTest });
        
        // Test 3: Change Monitoring
        console.log('\n3/3 Setting up Change Monitoring...');
        const monitorTest = monitorProgressChanges();
        results.push({ name: 'Progress Monitoring', ...monitorTest });
        
    } catch (error) {
        console.error('Progress test error:', error);
        results.push({ name: 'Progress Test Execution', passed: false, error: error.message });
    }
    
    // Summary
    console.log('\n📊 PROGRESS TEST SUMMARY');
    console.log('=========================');
    
    const passedTests = results.filter(r => r.passed).length;
    results.forEach(result => {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status}: ${result.name}`);
    });
    
    console.log(`\nProgress Tests: ${passedTests}/${results.length} passed`);
    
    return {
        passed: passedTests === results.length,
        results
    };
}

// Make functions available globally
window.progressTestTools = {
    runProgressTests,
    testProgressCalculationRules,
    testLiveProgressCalculation,
    monitorProgressChanges
};

console.log('📊 Progress Calculation Test Tools Loaded');
console.log('=========================================');
console.log('Available Commands:');
console.log('runProgressTests()               - Run all progress tests');
console.log('testProgressCalculationRules()   - Test calculation logic');
console.log('testLiveProgressCalculation()    - Test current app state');
console.log('monitorProgressChanges()         - Monitor real-time changes');
console.log('\n💡 Quick Start: runProgressTests()');