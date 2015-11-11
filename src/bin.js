import main from './index'

main()
.then(console.log)
.catch(err => console.log(err.stack))
