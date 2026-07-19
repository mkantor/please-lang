# Please

A functional programming language oriented around edge-labeled trees[^1].

## Quick Start

```sh
git clone git@github.com:mkantor/please-lang.git
cd please-lang
npm install
npm run build
echo '@runtime { context => :context.program.start_time }' | ./please
```

There are more example programs in [`./examples`](./examples).

## What This Repository Is

**This implementation of Please is a proof of concept**. There are bugs and
missing pieces, and language syntax/semantics may change backwards-incompatibly
on the way to an official release.

### Current State

Enough pieces exist to write runnable programs, but the standard library is
anemic, documentation is lacking, and editor tooling is nonexistent.

The current runtime is an interpreter, but the plan is to eventually add one or
more backends to allow building native executables.

## Language Design

### Syntax

A Please program is primarily composed of atoms, objects, lookups, and
functions.

#### Atoms

Atoms are the raw textual portions of your source code. They're similar to
strings from other programming languages, except there isn't a specific runtime
data representation implied by the fact that a value is an atom (e.g. the atom
`2` may be an integer in memory).

Bare words not containing any
[reserved character sequences](./src/language/parsing/atom.ts#L41-L67) are
atoms:

```plz
Hello
```

Atoms can be quoted:

```plz
"Hello, World!"
```

#### Objects

Objects are maps of key/value pairs ("properties"), where keys must be atoms:

```plz
{ greeting: "Hello, World!" }
```

Properties are delimited by newlines or commas; these mean the same thing:

```plz
{
  a: 1
  b: 2
}
```

```plz
{ a: 1, b: 2 }
```

Properties without explicitly-written keys are automatically enumerated:

```plz
{ a, b } // is the same as { 0: a, 1: b }
```

#### Lookups

Data can be referenced from other places in the program using lookups, like
`:en` below:

```plz
{
  en: "Hello, World!"
  zh: "世界您好！"
  hi: "हैलो वर्ल्ड!"
  es: "¡Hola, Mundo!"
  default: :en
}
```

The runtime value of the `default` property will be `"Hello, World!"`.

You can index into the properties of looked-up values:

```plz
{
  deeply: {
    nested: {
      greeting: "Hello, World!"
    }
  }
  greeting: :deeply.nested.greeting // "Hello, World!"
}
```

Index keys may be computed dynamically[^2]:

```plz
{
  a: { 2: { greeting: "Hello, World!" } }
  :a.(1 + 1).greeting // "Hello, World!"
}
```

Lookups are lexically scoped:

```plz
{
  greeting: "Hello, World!"
  scope: {
    greeting: "Hi, Moon!"
    a: :greeting // "Hi, Moon!"
  }
  b: :greeting // "Hello, World!"
}
```

Lookups can "look ahead" to properties defined later in the program:

```plz
{
  b: :a // this works
  a: 42
}
```

`_` is a special name used for ignored properties/parameters and can't be
directly looked up (`:_` is an error). It's legal to drill into properties named
`_` via indexing, though (`:a._` is fine).

#### Functions

Functions take exactly one parameter and their body is exactly one expression:

```plz
{
  make_pair: a => { :a, :a }
}
```

Functions can be applied:

```plz
{
  f: a => :a
  greeting: :f("Hello, World!")
}
```

Infix notation can be used to apply binary functions (those which look like
`b => a => …`). For example, the expression `x f y` desugars to `:f(y)(x)`.
Here's another example:

```plz
{
  cons: b => a => { :a, :b }
  list: 1 cons (2 cons 3) // { 1, { 2, 3 } }
}
```

The standard library contains symbolically-named functions for arithmetic and
other familiar binary operations. For example, `1 + 2 - 3` is `0`. Also included
in the standard library are the functions`|>` (pipe) and `>>` (flow):

```plz
{
  // `>>` composes functions
  append_bc: :atom.append(b) >> :atom.append(c)

  // `|>` pipes an argument into a function
  abc: a |> :append_bc
}
```

All binary operations are left-associative and there is no operator precedence.
Use of parentheses is encouraged.

#### Keywords

The functions and lookups shown above are syntax sugars for _keyword
expressions_. Most of the interesting stuff that Please does involves evaluating
keyword expressions.

Under the hood, keyword expressions are modeled as objects. For example, `:foo`
desugars to `{ 0: "@lookup", 1: { key: foo } }`. All such expressions have a
property named `0` referring to a value that is an `@`-prefixed atom (the
keyword). Most keyword expressions also require a property named `1` to pass an
argument to the expression. Keywords include `@apply`, `@check`, `@function`,
`@hole`, `@if`, `@index`, `@lookup`, `@object`, `@panic`, `@runtime`, and
`@union`.

In addition to the specific syntax sugars shown above, any keyword expression
can be written using a generalized sugar:

```plz
@keyword { … } // desugars to `{ 0: "@keyword", 1: { … } }`
```

### Semantics

Please is a functional programming language. Currently all functions are pure,
with a sole exception: logging to stderr can happen from anywhere. The specific
approach to modeling other runtime side effects is still to be decided[^3].

Once desugared, a Please program is either an atom or an object. Please code is
data in the same sense as in Lisp.

Before a Please program terminates, it prints the fully-resolved version of
itself to standard output. That means `hello-world.plz` can be as simple as
this:

```plz
"Hello, World!"
```

`@runtime` expressions allow accessing runtime context (like command-line
arguments). A `@runtime` expression is conceptually a bit like the `main`
function from other programming languages, except there can be any number of
`@runtime` expressions in a given program. Here's an example:

```plz
@runtime { context => :context.program.start_time }
```

Unsurprisingly, this program outputs the current time when run.

Code outside of `@runtime` expressions is evaluated at compile-time as much as
possible. For example, this program compiles to the literal value `2` (no
computation will occur at runtime):

```plz
1 + 1
```

There's no module system yet (all Please programs are single files), but that
will change.

### Type System

Please has a
[structural type system](https://en.wikipedia.org/wiki/Structural_type_system)
with support for [subtyping](https://en.wikipedia.org/wiki/Subtyping),
[union types](https://en.wikipedia.org/wiki/Union_type),
[generic function types](https://en.wikipedia.org/wiki/Generic_function), and
[literal (singleton) types](https://en.wikipedia.org/wiki/Unit_type) for atoms.

Types can be inferred in most situations, but function parameters can be
annotated:

```plz
{
  increment: (a: :integer.type) => :a + 1
}
```

The `~` operator (syntax sugar for the `@check` keyword) can be used for type
ascription of expressions:

```plz
:a ~ :boolean.type
```

An error will be raised at compile time if `:a` is not a boolean value.

Types are values in Please, and can be created and transformed via any mechanism
you'd apply to other values (you can return them from functions, pass them as
arguments, use `@if` to base them on a condition, etc).

Function types can be denoted using `~>` instead of `=>` to avoid naming the
parameter, but this is merely syntax sugar. `a ~> b` is exactly equivalent to
`(_: a) => b`.

#### Generic Programming

Please functions are generally generic, even when the parameter is explicitly
annotated. Each part of the annotation becomes an implicit type parameter
constrained by it, so the specific argument's type flows through to the return
value:

```plz
{
  identity_for_integers: (n: :integer.type) => :n
  answer: :identity_for_integers(42) ~ 42 // return type is `42`, not `:integer.type`
}
```

Un-annotated functions are generic with the top type (`:something.type`) as the
implied constraint.

When you need to refer to a type parameter explicitly (for example to share its
identity across multiple expressions) introduce a "hole" with `?`:

```plz
{
  apply2: a =>
    (f: :a ~> ?b) =>
    //   ^ refers to the implicit type parameter from the outermost function
    (g: :b ~> ?c) =>
    //   ^ refers to the type parameter introduced by `?b`
      :g(:f(:a))
}
```

A lone `?` is an anonymous hole, and `(?a: type)` introduces a hole with a
constraint.

#### Value-Level Reasoning

Type inference isn't limited to classifying values into broad buckets. It
follows specific values through the program and understands how runtime
operations transform them. For example, Please knows that the natural numbers
are closed under addition, so the result below is statically known to be a
natural number (without requiring a runtime check):

```plz
(a: :natural_number.type) => (:a + 1) ~ :natural_number.type
```

There is no overloading; this is the same `+` function that's used for integers.

Subtraction can underflow, so it _isn't_ closed over the natural numbers; an
analogous program using `:a - 1` is rejected at compile time because the
inferred type is only `:integer.type` (`:a` could be `0`, then `:a - 1` would be
`-1` which isn't a natural number).

The same precision applies to objects, e.g. indexing an object by a union-typed
key yields a union of exactly the values that key could select:

```plz
{
  scores: { alice: 1, bob: 2, charlie: 3 }
  get_score: (who: alice | bob) => :scores.:who ~ (1 | 2)
}
```

`@if` expressions benefit from similar analysis. When a condition is statically
decidable the untaken branch is pruned, so a function's return type can depend
on its argument's _value_:

```plz
{
  classify: (a: :integer.type) =>
    @if {
      :a < 0
      then: negative
      else: non_negative
    }

  // results are statically known to be `negative`/`non_negative`:
  :classify(-5) ~ negative
  :classify(3) ~ non_negative
}
```

The result would only be widened to `negative | non_negative` when the
argument's sign can't be known until runtime.

This value-aware analysis is reminiscent of
[dependent types](https://en.wikipedia.org/wiki/Dependent_type), but it falls
out of ordinary inference instead of requiring elaborate type
annotations/proofs.

### Layering

Please is a layered language. It can be thought of as a stack of three smaller
languages:

- Layer 0 (`plz`) is the surface syntax. This is the language you as a human
  typically use to write programs.
- Layer 1 (`plo`) is a desugared/normalized representation of the syntax tree.
- Layer 2 (`plt`) is the result of applying semantic analysis, compile-time
  evaluation, and other reductions to the `plo` tree. For now the language
  runtime is a `plt` interpreter, but eventually there will be compiler backends
  to lower `plt` to machine code and/or other targets.

`plz` has a specific textual representation, but `plo` & `plt` could be encoded
in any format in which hierarchical key/value pairs of strings are representable
(currently only JSON is implemented, but YAML, TOML, HOCON, BSON, S-expressions,
MessagePack, CBOR, etc could be supported).

Take this example `plz` program:

```plz
{
  language: Please
  message: :atom.prepend("Welcome to ")(:language)
  now: @runtime { context => :context.program.start_time }
}
```

It desugars to the following `plo` program:

```plz
{
  language: Please
  message: {
    0: "@apply"
    1: {
      function: {
        0: "@apply"
        1: {
          function: {
            0: "@index"
            1: {
              object: {
                0: "@lookup"
                1: {
                  key: atom
                }
              }
              query: {
                0: prepend
              }
            }
          }
          argument: "Welcome to "
        }
      }
      argument: {
        0: "@lookup"
        1: {
          key: language
        }
      }
    }
  }
  now: {
    0: "@runtime"
    1: {
      0: {
        0: "@function"
        1: {
          parameter: context
          body: {
            0: "@index"
            1: {
              object: {
                0: "@lookup"
                1: {
                  key: context
                }
              }
              query: {
                0: program
                1: start_time
              }
            }
          }
        }
      }
    }
  }
}
```

Which in turn compiles to the following `plt` program:

```plz
{
  language: Please
  message: "Welcome to Please"
  now: {
    0: "@runtime"
    1: {
      function: {
        0: "@function"
        1: {
          parameter: context
          body: {
            0: "@index"
            1: {
              object: {
                0: "@lookup"
                1: {
                  key: context
                }
              }
              query: {
                0: program
                1: start_time
              }
            }
          }
        }
      }
    }
  }
}
```

Which produces the following runtime output:

```plz
{
  language: Please
  message: "Welcome to Please"
  now: "2025-05-13T22:47:50.802Z"
}
```

After an eventual stable release of Please, `plo` & `plt` will be versioned to
ensure backwards compatibility.

Many compilers use intermediate representations (IRs) internally. Please's
layers serve a similar purpose, though unlike some other IRs they are
serializable, stable, and are designed to be human-readable (albeit verbose).

What is this good for? Use cases include:

- distributing lower-layer representations for efficiency in an eventual package
  manager
- experimenting with alternative syntaxes while remaining compatible with the
  rest of the ecosystem
- caching `plo` & `plt` artifacts to speed up recompiles
- applying new optimizations to existing programs without compiling from scratch
- manipulating `plo` & `plt` with any tool that can handle common formats like
  JSON (use [`jq`](https://jqlang.github.io/jq/) to refactor your code!)

### Philosophy

The first-order goal of Please is to be pleasant to use.

It strives to:

- help you express your ideas clearly, concisely, and correctly
- catch mistakes and oversights without being annoying or confusing
- be useful across many different contexts & domains
- be extensible to accommodate novel use cases
- make it easy to pay off technical debt
- emit programs that you have confidence in

The current implementation doesn't live up to these aspirations, but hopefully
it approaches them over time.

[^1]:
    Every Please program is an
    [arborescence](<https://en.wikipedia.org/wiki/Arborescence_(graph_theory)>)
    with edges labeled by property keys.

[^2]:
    Dynamic keys are checked. `{ 2: "Hello, World!" }.(1 + 41)` is a type error.

[^3]:
    It'll probably be
    [monads](<https://en.wikipedia.org/wiki/Monad_(functional_programming)>),
    but maybe an [effect system](https://en.wikipedia.org/wiki/Effect_system)?
