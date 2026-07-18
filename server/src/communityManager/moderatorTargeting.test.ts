import assert from 'node:assert/strict';
import test from 'node:test';
import { moderatorParticipantLabel, targetedModeratorSanctionNotice } from '../moderator/interventionResponse';

test('moderator warning addresses a participant by username',()=>{
  assert.equal(moderatorParticipantLabel('NotMolchun','Andrey Molchanov'),'@NotMolchun');
  assert.equal(targetedModeratorSanctionNotice('Предупреждение 1 из 5.','NotMolchun','Andrey Molchanov'),'@NotMolchun: Предупреждение 1 из 5.');
});

test('moderator warning falls back to a safe display name',()=>{
  assert.equal(moderatorParticipantLabel(undefined,'  Андрей <script>  '),'Андрей script');
  assert.equal(moderatorParticipantLabel(undefined,undefined),'Участник');
});
