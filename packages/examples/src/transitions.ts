import {makeProject} from '@twick/core';

import first from './scenes/transitions-first';
import second from './scenes/transitions-second';

export default makeProject({
  scenes: [first, second],
});
