// Build-only bridge. The implementation remains in the root pure domain
// modules; esbuild packages exactly those validators for Functions/tests.
import * as goalArchitectCommit from '../../src/lib/goalArchitect/commitGoalArchitectureDraft';
import * as goalArchitectIds from '../../src/lib/goalArchitect/ids';
import * as goalArchitectValidation from '../../src/lib/goalArchitect/validation';
import * as wpiCommit from '../../src/lib/weeklyPlanner/commitDraft';
import * as wpiConflicts from '../../src/lib/weeklyPlanner/conflicts';

export {
  goalArchitectCommit,
  goalArchitectIds,
  goalArchitectValidation,
  wpiCommit,
  wpiConflicts,
};
