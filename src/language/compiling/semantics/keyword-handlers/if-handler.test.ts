import { elaborationSuite, success } from '../test-utilities.test.js'

elaborationSuite('@if', [
  [
    { 0: '@if', 1: { condition: 'false', then: 'no', else: 'yes' } },
    success('yes'),
  ],
  [
    { 0: '@if', 1: { condition: 'true', then: 'yes', else: 'no' } },
    success('yes'),
  ],
  [
    {
      0: '@if',
      1: {
        condition: 'true',
        then: 'it works!',
        else: { 0: '@panic' },
      },
    },
    success('it works!'),
  ],
  [
    {
      a: 'it works!',
      b: {
        0: '@if',
        1: {
          condition: 'true',
          then: { 0: '@lookup', 1: { key: 'a' } },
          else: { 0: '@panic' },
        },
      },
    },
    success({ a: 'it works!', b: 'it works!' }),
  ],
  [
    {
      0: '@if',
      1: {
        condition: 'false',
        then: { 0: '@panic' },
        else: 'it works!',
      },
    },
    success('it works!'),
  ],
  [
    {
      0: '@if',
      1: {
        condition: {
          0: '@apply',
          1: {
            function: {
              0: '@index',
              1: {
                object: { 0: '@lookup', 1: { key: 'boolean' } },
                query: { 0: 'not' },
              },
            },
            argument: 'false',
          },
        },
        then: 'it works!',
        else: { 0: '@panic' },
      },
    },
    success('it works!'),
  ],
  [
    {
      0: '@if',
      1: {
        0: {
          0: '@apply',
          1: {
            function: {
              0: '@index',
              1: {
                object: { 0: '@lookup', 1: { key: 'boolean' } },
                query: { 0: 'not' },
              },
            },
            argument: 'false',
          },
        },
        1: 'it works!',
        2: { 0: '@panic' },
      },
    },
    success('it works!'),
  ],
  [
    {
      a: {
        0: '@if',
        1: {
          condition: { 0: '@lookup', 1: { key: 'b' } },
          then: 'it works!',
          else: { 0: '@panic' },
        },
      },
      b: 'true',
    },
    success({ a: 'it works!', b: 'true' }),
  ],
  [{ 0: '@if', 1: { 0: 'true', 1: 'yes', 2: 'no' } }, success('yes')],
  [
    { 0: '@if', 1: { 0: 'false', 1: { 0: '@panic' }, 2: 'it works!' } },
    success('it works!'),
  ],
  [{ 0: '@if', 1: { 0: 'true', 1: '@@lookup', 2: 'no' } }, success('@lookup')],
])
