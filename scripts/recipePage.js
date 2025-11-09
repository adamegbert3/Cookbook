import { recipes } from "./recipes.js";

function loadRecipe() {
    const name = localStorage.getItem("selectedRecipe");
    const recipe = recipes.find(r => r.name === name);

    if (!recipe) {
        document.getElementById("recipe").innerHTML = "<h2>Recipe not found.</h2>";
        return;
    }

    const html = `
        <h1>${recipe.name}</h1>
        <h3>Ingredients</h3>
        <ul>
            ${recipe.recipeIngredient.map(i => `<li>${i}</li>`).join("")}
        </ul>

        <h3>Instructions</h3>
        <ol>
            ${recipe.recipeInstructions.map(step => `<li>${step}</li>`).join("")}
        </ol>

        <h3>Tags</h3>
        <p>${recipe.tags.join(", ")}</p>
    `;

    document.getElementById("recipe").innerHTML = html;
}

loadRecipe();
