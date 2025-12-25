# Life Tracker - Comprehensive Testing Script

This document provides a complete testing strategy for validating the Definition of Done checklist for the Life Tracker app.

## Quick Test Summary

Execute these commands to run all tests:

```bash
# 1. Build Test
npm run build

# 2. Development Performance Test 
npm run dev
# Then access http://localhost:3000 and measure load time

# 3. Auth Flow Test
# Access app without login, verify only auth modal visible

# 4. Feature Tests
# Test TimeBlock lifecycle, Progress rollup, Overdue tooltips, Habits tracking
```

## Test Requirements & Implementation

### 1. Build Success Test ✅

**Requirement**: `npm run build` completes successfully

**Test Command**:
```bash
cd /mnt/c/Users/Franc/Desktop/LIFE_TRACKING
npm run build
```

**Success Criteria**:
- Build completes without errors
- `out/` directory is created with static files
- No TypeScript compilation errors
- No missing dependency errors

**Expected Output**:
```
✓ Compiled successfully
✓ Exporting static pages
✓ Creating .nojekyll file for GitHub pages
```

---

### 2. Auth UX Rule Test 🔒

**Requirement**: Before login, no UI app components should be visible under the Auth screen - only clean dark background + login card

**Implementation Analysis**:
- **File**: `/src/app/page.tsx` - Contains `AuthGate` component
- **Logic**: 
  - `status === 'unknown'` → Shows `LoadingScreen`
  - `status === 'signedOut'` → Shows `LoginScreen` (only `AuthModal`)
  - `status === 'signedIn'` → Shows `DataGate` → `MainApp`

**Test Steps**:
1. Open app in incognito mode
2. Verify ONLY auth modal is visible
3. Check no MainApp components are rendered
4. Verify dark gradient background is present

**Test Command**:
```bash
# Start development server
npm run dev
# Access http://localhost:3000 in incognito mode
```

**Verification**:
- **DOM Check**: Look for `data-testid="app-ready"` - should NOT be present when signed out
- **Visual Check**: Only see gradient background + white auth modal
- **Component Check**: No header, no modules, no timeblock planner visible

**Code Analysis**:
```typescript
// In AuthGate component (page.tsx line 41-56)
if (status === 'signedOut') {
  return <LoginScreen />; // Only AuthModal, no MainApp
}
```

---

### 3. Init Performance Test ⚡

**Requirement**: Perceived performance < 2s in dev, app unlocks UI after essential data loads

**Implementation Analysis**:
- **File**: `/src/providers/DataProvider.tsx` - Controls data loading states
- **States**: `idle` → `loading` → `ready` | `error`
- **UI Unlock**: When `DataLoadingGate` gets `status === 'ready'`, renders `MainApp`

**Test Steps**:
1. Open browser DevTools → Network tab
2. Clear cache, reload page
3. Measure time from page load to `data-testid="app-ready"` appears
4. Verify loading states work correctly

**Test Script**:
```javascript
// Browser console timing test
console.time('App Init');
function checkAppReady() {
  if (document.querySelector('[data-testid="app-ready"]')) {
    console.timeEnd('App Init');
    console.log('✅ App is ready!');
  } else {
    setTimeout(checkAppReady, 100);
  }
}
checkAppReady();
```

**Success Criteria**:
- Loading screen appears immediately
- Essential data loads within 2s
- App becomes interactive (buttons clickable)
- No JavaScript errors in console

---

### 4. TimeBlock Lifecycle Test 📅

**Requirement**: Can create + complete + cancel a time block successfully

**Implementation Analysis**:
- **File**: `/src/components/TimeBlockPlanner.tsx`
- **Actions**: Create (drag/click), Complete (toggle), Delete (trash button)
- **States**: `planned` → `completed` | `cancelled` (via delete)

**Test Steps**:

#### 4a. Create TimeBlock
1. Go to "Time Planner" tab
2. Click "Add Block" or drag on timeline
3. Fill form: title, type, start/end time
4. Click "Create Block"
5. Verify block appears on timeline

#### 4b. Complete TimeBlock  
1. Click the ⭕ button on a time block
2. Verify it changes to ✅
3. Verify status updates to "completed"
4. Check that actualStartTime/actualEndTime are set

#### 4c. Cancel/Delete TimeBlock
1. Click trash 🗑️ button on time block
2. Confirm deletion in popup
3. Verify block disappears from timeline

**Test Data**:
```javascript
// Test TimeBlock creation data
const testBlock = {
  title: "Test Block",
  type: "work",
  startTime: "10:00",
  endTime: "11:00",
  description: "Testing creation"
};
```

**Database Verification**:
- Check Firebase/IndexedDB for correct storage
- Verify userId is properly set
- Confirm status transitions are persisted

---

### 5. Progress Rollup Test 📊

**Requirement**: Completing 1h time block on task → task/project/goal progress increases and percentages change

**Implementation Analysis**:
- **Progress Rule**: Based on actual hours from completed TimeBlocks
- **Rollup Logic**: TimeBlock(completed) → Task actual → Project actual → Goal actual  
- **Calculation**: `(actualEndTime - actualStartTime)` or fallback to `(endTime - startTime)`

**Test Steps**:

#### Setup Test Data
1. Create Goal: "Learn TypeScript" (target: 10h)
2. Create Project: "Build Todo App" (target: 5h) 
3. Create Task: "Setup project" (target: 1h)
4. Link TimeBlock to Task

#### Execute Test
1. Create 1-hour TimeBlock linked to task
2. Mark TimeBlock as completed
3. Record progress before/after

#### Verify Rollup
1. **Task Progress**: Should increase by 1h actual time
2. **Project Progress**: Should increase by 1h actual time  
3. **Goal Progress**: Should increase by 1h actual time
4. **Percentages**: Should update automatically

**Test Script**:
```javascript
// Progress tracking test
const trackProgress = (entityId, entityType) => {
  const before = getCurrentProgress(entityId, entityType);
  // Complete TimeBlock action
  completeTimeBlock(timeBlockId);
  const after = getCurrentProgress(entityId, entityType);
  
  console.log(`${entityType} Progress:`, {
    before: before,
    after: after,
    difference: after.actual - before.actual
  });
};
```

**Expected Changes**:
- Task: 0h → 1h (100% if target was 1h)
- Project: 0h → 1h (20% if target was 5h)  
- Goal: 0h → 1h (10% if target was 10h)

---

### 6. Overdue Logic Test ⚠️

**Requirement**: Tooltip is coherent, no "false overdue" warnings

**Implementation Analysis**:
- **File**: `/src/components/TimeBlockPlanner.tsx` lines 346-390
- **Logic**: `isOverdue = now > blockEndTime && status !== 'completed'`
- **Fix**: Uses selectedDate as reference for HH:mm parsing

**Test Cases**:

#### 6a. Not Overdue Cases
- Future blocks (`endTime > now`)
- Completed blocks (`status === 'completed'`)
- Cancelled blocks (`status === 'cancelled'`)

#### 6b. Overdue Cases  
- Past blocks (`endTime < now`) with `status === 'planned'`
- In-progress blocks past their end time

#### 6c. Edge Cases
- Blocks created with HH:mm strings vs full DateTime objects
- Cross-midnight blocks
- Different timezone scenarios

**Test Script**:
```javascript
// Overdue logic verification
const testOverdueLogic = () => {
  const now = new Date();
  const testBlocks = [
    { endTime: new Date(now.getTime() + 3600000), status: 'planned' }, // Future
    { endTime: new Date(now.getTime() - 3600000), status: 'completed' }, // Past but completed
    { endTime: new Date(now.getTime() - 3600000), status: 'planned' }, // Actually overdue
  ];
  
  testBlocks.forEach((block, i) => {
    const isOverdue = getOverdueMessage(block);
    console.log(`Block ${i}:`, { 
      endTime: block.endTime.toLocaleString(),
      status: block.status,
      overdue: isOverdue,
      expected: i === 2 ? 'Should be overdue' : 'Should NOT be overdue'
    });
  });
};
```

---

### 7. Habits Tracking Test 🔥

**Requirement**: Click on habit toggle creates/removes log for today and updates counters

**Implementation Analysis**:
- **File**: `/src/components/HabitsTracker.tsx`
- **Toggle Logic**: `handleToggleHabit()` function (line 160-188)
- **State Management**: Updates streak counts and completion percentages

**Test Steps**:

#### Setup Test Habit
1. Go to "Habits" tab
2. Click "Add Habit" 
3. Create habit: "Drink Water" (daily)

#### Test Toggle On
1. Click circle ⭕ button next to habit
2. Verify it changes to ✅ 
3. Check "Completed Today" counter increases
4. Verify streak count increases

#### Test Toggle Off
1. Click checkmark ✅ button 
2. Verify it changes back to ⭕
3. Check "Completed Today" counter decreases
4. Verify streak count decreases

**Database Verification**:
```javascript
// Check HabitLog creation/deletion
const verifyHabitLog = async (habitId) => {
  const today = new Date().toDateString();
  const logs = await db.getByIndex('habitLogs', 'dateKey', today);
  const habitLog = logs.find(log => log.habitId === habitId);
  
  console.log('Habit Log for today:', {
    exists: !!habitLog,
    completed: habitLog?.completed,
    dateKey: habitLog?.dateKey
  });
};
```

**Counter Updates**:
- "Completed Today": Real-time count of today's completed habits
- "Active Streaks": Count of habits with current streak > 0
- "Best Streak": Maximum streak across all habits
- "Avg Completion": Monthly completion percentage

---

## Running the Full Test Suite

### Environment Setup
```bash
cd /mnt/c/Users/Franc/Desktop/LIFE_TRACKING
npm install
npm run build # Verify build works
npm run dev   # Start development server
```

### Manual Testing Checklist

1. **Build Test** ✅
   - [ ] `npm run build` completes successfully
   - [ ] No TypeScript errors
   - [ ] Static files generated in `out/`

2. **Auth UX Rule** 🔒
   - [ ] Open in incognito mode
   - [ ] Only auth modal visible (no app components)
   - [ ] Dark gradient background present
   - [ ] No `data-testid="app-ready"` element

3. **Init Performance** ⚡
   - [ ] Page loads in < 2s
   - [ ] Loading states work properly
   - [ ] App becomes interactive quickly
   - [ ] No console errors

4. **TimeBlock Lifecycle** 📅
   - [ ] Can create blocks via drag or button
   - [ ] Can mark blocks as completed 
   - [ ] Can delete blocks
   - [ ] Changes persist to database

5. **Progress Rollup** 📊
   - [ ] Complete 1h TimeBlock linked to Task
   - [ ] Task actual hours increase by 1
   - [ ] Project actual hours increase by 1  
   - [ ] Goal actual hours increase by 1
   - [ ] Percentages update correctly

6. **Overdue Logic** ⚠️
   - [ ] Future blocks not marked overdue
   - [ ] Completed blocks not marked overdue
   - [ ] Past incomplete blocks ARE marked overdue
   - [ ] Tooltip messages are accurate

7. **Habits Tracking** 🔥
   - [ ] Click habit toggle creates today's log
   - [ ] Click again removes today's log
   - [ ] Counters update in real-time
   - [ ] Streak calculations work correctly

### Automated Testing Commands

```bash
# 1. Build verification
npm run build 2>&1 | tee build-test.log

# 2. Static analysis  
npm run lint 2>&1 | tee lint-test.log

# 3. Type checking
npx tsc --noEmit 2>&1 | tee type-check.log

# 4. Start dev server (manual testing)
npm run dev
```

### Browser Console Test Scripts

Execute these in browser DevTools while testing:

```javascript
// 1. Performance timing
console.time('App Init');
function waitForAppReady() {
  if (document.querySelector('[data-testid="app-ready"]')) {
    console.timeEnd('App Init');
    return true;
  }
  setTimeout(waitForAppReady, 100);
}
waitForAppReady();

// 2. Auth state verification
console.log('Auth Elements:', {
  authModal: !!document.querySelector('.modal-portal'),
  mainApp: !!document.querySelector('[data-testid="app-ready"]'),
  expected: 'Only authModal should be true when signed out'
});

// 3. TimeBlock creation test
const testTimeBlockCreation = () => {
  const addButton = document.querySelector('button:contains("Add Block")');
  if (addButton) addButton.click();
  console.log('TimeBlock creation modal opened');
};

// 4. Progress tracking
const trackProgressChanges = () => {
  const kpis = document.querySelector('[data-testid="kpi-dashboard"]');
  console.log('Current KPIs:', kpis?.textContent);
};
```

## Expected Results Summary

### ✅ Pass Criteria
1. **Build**: Completes without errors, generates static files
2. **Auth**: Clean separation, no app components visible pre-login
3. **Performance**: Sub-2s perceived load time in development
4. **TimeBlocks**: Full CRUD lifecycle works end-to-end
5. **Progress**: Hierarchical rollup from TimeBlock → Task → Project → Goal
6. **Overdue**: Accurate logic, no false positives
7. **Habits**: Toggle creates/removes logs, updates counters

### ❌ Fail Indicators
- Build errors or warnings
- App components visible before authentication
- Slow load times (>2s) or unresponsive UI
- TimeBlock actions don't persist or update UI
- Progress calculations incorrect or don't cascade
- Overdue warnings on future/completed blocks
- Habit toggles don't create logs or update counts

### 🔧 Debug Commands
```bash
# Check build output
ls -la out/

# Monitor real-time logs
tail -f .next/trace

# Check database state (Firebase)
# Use Firebase console or browser DevTools → Application → IndexedDB

# Network debugging
# Use DevTools → Network tab to monitor API calls
```

This comprehensive testing strategy covers all the Definition of Done requirements and provides both manual and automated verification methods.