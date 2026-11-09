import {randomBytes,scryptSync} from 'node:crypto';
// Pipe a chosen password into stdin from a private terminal; never pass it as an argument.
let input='';for await(const chunk of process.stdin)input+=chunk;const password=input.replace(/\r?\n$/,'');if(password.length<16)throw Error('Use a password with at least 16 characters.');const salt=randomBytes(16).toString('hex');process.stdout.write(salt+':'+scryptSync(password,salt,64).toString('hex'));
