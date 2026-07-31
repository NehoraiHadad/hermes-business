import React from 'react'

// Hermes compiles the shipped plugin without JSX, so every element is built with
// React.createElement. `h` is the shared shorthand used across the shell modules.
export const h = React.createElement
