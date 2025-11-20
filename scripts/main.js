import { recipes } from "./recipes.js";
import { auth, onAuthStateChanged } from "./firestoreapi.js";

function Random(num) {
    return Math.floor(Math.random() * num);
}

// function GetRandomRecipe(list) {
//     const listlength = list.length;
//     const random = Random(listlength);
//     return list[random];
// }

function RecipeTemplate(recipe) {
    return `\
    <div class="recipe-card" data-name="${recipe.name}">\
        <div id="info">\
            <div id="tags">\
                ${tagsTemplate(recipe.tags)}\
            </div>\
                <h2>${recipe.name}</h2>\
            </div>\
        
        <div id="author">\
            <p>By: ${recipe.author}</p>\
            </div>\
        </div>\
    </div>`;
}

function tagsTemplate(tags){
    let html = '';
    tags.forEach(tag => {
        html += '<p>' + tag + '</p>';
    });

    return html;
}

function renderRecipes(recipes) {
    let html = '';
    recipes.forEach(recipe => {
        html += RecipeTemplate(recipe);
    });
    document.getElementById('recipes').innerHTML = html;

    // click handler for all recipe cards
    document.querySelectorAll(".recipe-card").forEach(card => {
        card.addEventListener("click", () => {
            const name = card.getAttribute("data-name");
            // store name in localStorage
            localStorage.setItem("selectedRecipe", name);
            // navigate to a new page
            window.location.href = "recipe.html";
        });
    });
}

function init() {
  // get a random recipe
//   const recipe = GetRandomRecipe(recipes)
  // render the recipe with renderRecipes.
  renderRecipes(recipes);
}
init();

function filter(query) {
    const filtered = recipes.filter(recipe => {
        const filterednames = recipe.name.toLowerCase().includes(query);
        const filteredtags = recipe.tags.some(tag => tag.toLowerCase().includes(query));
        return filterednames || filteredtags
    });
    const sorted = filtered.sort((a,b) => a.name.localeCompare(b.name));
    return sorted;
}


function searchHandler(e) {
    e.preventDefault();
    let search = document.getElementById('searchbar').value;
    const searchlower = search.toLowerCase();
    const filteredrecipes = filter(searchlower);
    renderRecipes(filteredrecipes);
}

document.getElementById('buttonimg').addEventListener('click', searchHandler);
document.getElementById('searchbar').addEventListener('keypress', function
    (event) {
        e.preventDefault();
        if (event.key === "Enter") {
            document.getElementById('buttonimg').click();
        }
    }
);

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById("notsigned").style.display = 'none';
        document.getElementById('recipes').style.display = 'block';
    }
});