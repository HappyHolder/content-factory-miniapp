export const communityManagerUpdateKey = (botId: number, updateId: number) => `${botId}:${updateId}`;

export const sameReplyBranch = (left?: number | null, right?: number | null) =>
  (left ?? null) === (right ?? null);

export function isProductContinuation(input: {
  classifiedIntent: string;
  classifiedRespond: boolean;
  repliedToIntent?: string | null;
  sameParticipantRecentProduct: boolean;
  directlyAddressed: boolean;
}) {
  if (input.classifiedIntent === 'product_support') return true;
  if (input.classifiedIntent !== 'conversation' || !input.classifiedRespond) return false;
  if (input.repliedToIntent === 'product_support') return true;
  return input.directlyAddressed && input.sameParticipantRecentProduct;
}
