/**
 * Gift Exchange Assignment Algorithm
 * Generates assignments for Secret Santa, White Elephant, etc.
 */

export interface Participant {
  id: string;
  user_id: string;
}

export interface AssignmentResult {
  success: boolean;
  assignments: Map<string, string>; // user_id -> assigned_to_user_id
  error?: string;
}

export interface AssignmentOptions {
  maxAttempts?: number;
  exclusions?: Record<string, string[]>; // user_id -> array of excluded user_ids
}

/**
 * Generate gift exchange assignments using a randomized algorithm
 * @param participants Array of participants
 * @param options Assignment options including exclusions
 * @returns AssignmentResult with assignments or error
 */
export function generateAssignments(
  participants: Participant[],
  options: AssignmentOptions = {}
): AssignmentResult {
  const { maxAttempts = 100, exclusions = {} } = options;

  // Need at least 3 participants for a valid exchange
  if (participants.length < 3) {
    return {
      success: false,
      assignments: new Map(),
      error: 'Need at least 3 participants for a gift exchange',
    };
  }

  // Try to generate assignments with multiple attempts
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = attemptAssignment(participants, exclusions);
    if (result.success) {
      return result;
    }
  }

  return {
    success: false,
    assignments: new Map(),
    error: `Could not generate valid assignments after ${maxAttempts} attempts. Check exclusion rules.`,
  };
}

/**
 * Single attempt at generating assignments
 */
function attemptAssignment(
  participants: Participant[],
  exclusions: Record<string, string[]>
): AssignmentResult {
  const assignments = new Map<string, string>();

  // Create a shuffled copy of participants
  const shuffled = [...participants].sort(() => Math.random() - 0.5);

  // Track who has already been assigned as a recipient
  const assigned = new Set<string>();

  for (let i = 0; i < shuffled.length; i++) {
    const giver = shuffled[i];
    const giverExclusions = exclusions[giver.user_id] || [];

    // Find valid recipients (not self, not excluded, not already assigned)
    const validRecipients = shuffled.filter(p =>
      p.user_id !== giver.user_id &&
      !giverExclusions.includes(p.user_id) &&
      !assigned.has(p.user_id)
    );

    // If no valid recipients, this attempt failed
    if (validRecipients.length === 0) {
      return {
        success: false,
        assignments: new Map(),
      };
    }

    // Randomly select a recipient
    const recipient = validRecipients[Math.floor(Math.random() * validRecipients.length)];

    assignments.set(giver.user_id, recipient.user_id);
    assigned.add(recipient.user_id);
  }

  // Verify: everyone should be both a giver and a receiver
  const givers = new Set(assignments.keys());
  const receivers = new Set(assignments.values());

  const allUserIds = new Set(participants.map(p => p.user_id));

  if (givers.size !== allUserIds.size || receivers.size !== allUserIds.size) {
    return {
      success: false,
      assignments: new Map(),
    };
  }

  return {
    success: true,
    assignments,
  };
}

/**
 * Validate existing assignments
 */
export function validateAssignments(
  participants: Participant[],
  assignments: Map<string, string>,
  exclusions: Record<string, string[]> = {}
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check all participants are givers
  for (const participant of participants) {
    if (!assignments.has(participant.user_id)) {
      errors.push(`${participant.user_id} is not assigned to give`);
    }
  }

  // Check all participants are receivers
  const receivers = new Set(assignments.values());
  for (const participant of participants) {
    if (!receivers.has(participant.user_id)) {
      errors.push(`${participant.user_id} is not assigned to receive`);
    }
  }

  // Check for self-assignments
  for (const [giver, receiver] of assignments) {
    if (giver === receiver) {
      errors.push(`${giver} is assigned to themselves`);
    }
  }

  // Check exclusions
  for (const [giver, receiver] of assignments) {
    const giverExclusions = exclusions[giver] || [];
    if (giverExclusions.includes(receiver)) {
      errors.push(`${giver} is assigned to excluded person ${receiver}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get assignment statistics
 */
export function getAssignmentStats(assignments: Map<string, string>): {
  totalParticipants: number;
  totalAssignments: number;
  averageChainLength: number;
} {
  const totalParticipants = new Set([...assignments.keys(), ...assignments.values()]).size;
  const totalAssignments = assignments.size;

  // Calculate average chain length (for circular assignments, this should be equal to total)
  let totalChainLength = 0;
  const visited = new Set<string>();

  for (const start of assignments.keys()) {
    if (visited.has(start)) continue;

    let current = start;
    let chainLength = 0;

    while (current && !visited.has(current)) {
      visited.add(current);
      chainLength++;
      const next = assignments.get(current);
      if (!next || next === start) break;
      current = next;
    }

    totalChainLength += chainLength;
  }

  return {
    totalParticipants,
    totalAssignments,
    averageChainLength: totalAssignments > 0 ? totalChainLength / totalAssignments : 0,
  };
}
