const { createExternalTool } = require('./code-session.cjs');
const { z } = require('zod');

function applicationTools(getContext) {
  if (!getContext) return [];
  const context = () => {
    const value = getContext();
    if (!value) throw Error('No active result request.');
    return value;
  };
  return [
    createExternalTool({
      name: 'list_results',
      description:
        'List host-registered result groups for this request and the current selection revision. Results appear automatically without calling selection tools. These are presentation records, not acceptance claims.',
      parameters: z.object({}).strict(),
      handler: async () => ({
        output: JSON.stringify(context().view()),
        message: 'Recorded results.',
      }),
    }),
    createExternalTool({
      name: 'select_result',
      description:
        'Optionally emphasize registered result group IDs. Keep multiple IDs for comparison, or choose a diagnostic report when requested. Supply the revision from list_results. historical=true allows explicitly viewing earlier versions in this chat; it never marks them as newly produced. Selection cannot change files or verification.',
      parameters: z
        .object({
          groupIds: z.array(z.string().min(1).max(320)).min(1).max(64),
          revision: z.number().int().nonnegative(),
          historical: z.boolean().optional(),
        })
        .strict(),
      handler: async request => ({
        output: JSON.stringify(context().select(request)),
        message: 'Result emphasis saved.',
      }),
    }),
  ];
}
module.exports = { applicationTools };
